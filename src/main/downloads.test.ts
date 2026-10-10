/**
 * The transfer queue: what is being fetched, in what order, and what happens
 * when one stops.
 *
 * What is on disk afterwards is `library.test.ts`. The queue asks the library
 * where a ROM goes and hands back what arrived, and knows nothing else about
 * it.
 */

import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  truncateSync,
  writeFileSync
} from 'node:fs'
import { readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import type { EmulatorState } from '@config/emulators'
import { SHARED_LIBRARY, type DownloadItem, type RommRom } from '@shared/types'
import { spaceOf } from './disk.ts'
import { DownloadManager } from './downloads.ts'
import { Library } from './library.ts'
import { log } from './log.ts'
import { OfflineCache } from './offline.ts'
import {
  checksumOf,
  CorruptDownloadError,
  RommClient,
  RommError,
  UnreachableError
} from './romm/index.ts'
import { resolveRoot, rootPaths } from './root.ts'
import { Store } from './store.ts'
import { zipDirectory } from './zip.ts'

/**
 * Where a downloaded game goes, and what RomMix believes about the ones already
 * there.
 *
 * The two questions this file exists for are the ones that cannot be seen by
 * reading a screen. A game planned into the wrong folder is invisible to the
 * emulator's own scanner while looking perfectly downloaded in RomMix; a game
 * on disk that adoption fails to recognise is a full re-download of something
 * the user already has. Both are silent, and both are decided here.
 *
 * Downloads are driven with a client that writes bytes to the path it is given
 * rather than a real server — the transfer itself is `romm.test.ts`'s subject.
 * The root is redirected with `GALLEON_HOME`, so nothing here touches the
 * RomMix folder of whoever is running the tests.
 */

const scratches: string[] = []
const realHome = process.env.GALLEON_HOME

/** Every queue a test made, so the teardown can wait for each to stop. */
const queues: DownloadManager[] = []

/** Every wire a test held, so a test that failed half-way still lets go. */
const wires: (() => void)[] = []

/**
 * Nothing is removed while anything still writes into it.
 *
 * A test is over when its assertions are, and the queue it started often is
 * not: the transfer it was watching still records itself in the store, and the
 * pump goes on to whatever was behind it. A folder removed under those writes
 * fails the removal (a file appears in a directory being emptied) or fails the
 * write, in whichever test happens to be running by then. Then the log, which
 * holds its path into whichever of these folders logged first. And the root
 * last of all, because a write that did slip past would otherwise land in the
 * RomMix folder of whoever is running the tests.
 */
afterEach(async () => {
  for (const release of wires.splice(0)) release()
  for (const downloads of queues.splice(0)) await downloads.whenIdle()
  log.close()
  if (realHome === undefined) delete process.env.GALLEON_HOME
  else process.env.GALLEON_HOME = realHome
  for (const dir of scratches.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rommix-downloads-test-'))
  scratches.push(dir)
  return dir
}

/** A queue the teardown knows to wait for. */
function queue(store: Store, client: RommClient, library: Library): DownloadManager {
  const downloads = new DownloadManager(store, client, library)
  queues.push(downloads)
  return downloads
}

/**
 * A transfer that stays on the wire until the test lets it go.
 *
 * The fake otherwise finishes within a few turns of starting, so a test about
 * what the queue does *while* something is downloading would be asserting
 * against a race it merely tends to win.
 */
function heldWire(): { held: Promise<void>; release: () => void } {
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  wires.push(release)
  return { held, release }
}

/**
 * How long `reached` waits before saying what it was waiting for.
 *
 * A backstop for a queue that never gets there, not a pace: every wait ends on
 * the event that answers it.
 */
const REACH_TIMEOUT_MS = 10_000

/** Wait until the queue reports something, by its own events rather than a clock. */
function reached(
  downloads: DownloadManager,
  check: (items: DownloadItem[]) => boolean,
  what: string
): Promise<void> {
  if (check(downloads.items)) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const listen = (items: DownloadItem[]): void => {
      if (!check(items)) return
      clearTimeout(deadline)
      downloads.off('update', listen)
      resolve()
    }
    const deadline = setTimeout(() => {
      downloads.off('update', listen)
      reject(new Error(`the queue never reached ${what}: ${JSON.stringify(downloads.items)}`))
    }, REACH_TIMEOUT_MS)
    downloads.on('update', listen)
  })
}

/** Until this ROM's transfer is the one on the wire. */
function onTheWire(downloads: DownloadManager, romId: number): Promise<void> {
  return reached(
    downloads,
    (items) => items.find((item) => item.romId === romId)?.state === 'downloading',
    `${romId} on the wire`
  )
}

function rom(fields: Partial<RommRom> = {}): RommRom {
  return {
    id: 1,
    name: 'Sonic the Hedgehog',
    fs_name: 'Sonic the Hedgehog (USA).md',
    fs_name_no_ext: 'Sonic the Hedgehog (USA)',
    fs_extension: 'md',
    fs_size_bytes: 512,
    platform_slug: 'genesis',
    platform_fs_slug: 'megadrive',
    platform_display_name: 'Sega Mega Drive',
    path_cover_small: null,
    path_cover_large: null,
    has_multiple_files: false,
    files: [{ file_name: 'Sonic the Hedgehog (USA).md' }],
    ...fields
  } as RommRom
}

/**
 * A client that answers with the ROM it is handed and writes the bytes asked
 * for.
 *
 * `breakAfter` writes that many bytes into the `.part` and then fails, which is
 * what an interrupted transfer leaves behind — the real client keeps the file
 * for the queue to decide about, and so does this.
 */
function fakeClient(
  options: {
    contents?: string
    roms?: Record<number, RommRom>
    breakAfter?: number
    /** How the break reads: an unreachable server, or something else. */
    breakReason?: typeof RommError
    /** How many attempts break before one is allowed through. Default one. */
    breakTimes?: number
    /** What the server says about fetching this ROM in pieces. */
    ranges?: boolean
    /** Whether the server can serve the game's files one at a time. */
    perFile?: boolean
    /**
     * The file, counted from one, that fails its hash check.
     *
     * What `RommClient.verify` does: the part-file is deleted and the transfer
     * throws, leaving whatever landed before it in place.
     */
    corruptFile?: number
    /**
     * Answer with a real archive holding these files, rather than loose bytes.
     *
     * The only way to reach the unpacking half of a download, which is where an
     * archived game is held to the hash RomM recorded for what is inside it.
     */
    zip?: Record<string, string>
    /** A whole-ROM transfer stays on the wire until this settles. See `heldWire`. */
    hold?: Promise<void>
  } = {}
): {
  client: RommClient
  resumed: boolean[]
} {
  const resumed: boolean[] = []
  const client = {
    async supportsRange() {
      return options.ranges !== false
    },
    async fileTransfers() {
      return { available: options.perFile === true, resumable: options.ranges !== false }
    },
    async downloadRomFile(
      file: { file_name: string; file_size_bytes: number },
      destination: string,
      onProgress: (progress: { received: number; total: number }) => void,
      _signal: AbortSignal,
      opts: { resume?: boolean } = {}
    ) {
      resumed.push(opts.resume === true)
      if (options.corruptFile === resumed.length) {
        await rm(`${destination}.part`, { force: true })
        throw new CorruptDownloadError('what arrived is not what RomM holds')
      }
      // The break happens on the first file only, for the same reason the whole
      // -ROM fake breaks once: what is under test is what RomMix does next.
      if (options.breakAfter !== undefined && resumed.length <= (options.breakTimes ?? 1)) {
        await writeFile(`${destination}.part`, '0'.repeat(options.breakAfter))
        throw new (options.breakReason ?? RommError)('the transfer from RomM kept breaking off')
      }
      const contents = '0'.repeat(file.file_size_bytes)
      await rm(`${destination}.part`, { force: true })
      await writeFile(destination, contents)
      onProgress({ received: contents.length, total: contents.length })
    },
    async rom(id: number) {
      const found = options.roms?.[id]
      if (!found) throw new RommError(`no ROM ${id}`)
      return found
    },
    // No artwork on this server, which is a 404 rather than a failure: what
    // the cache does with one is skip it and record the game anyway.
    async asset() {
      return new Response(null, { status: 404 })
    },
    async roms() {
      const items = Object.values(options.roms ?? {})
      return { items, total: items.length, limit: 200, offset: 0 }
    },
    async downloadRom(
      game: RommRom,
      destination: string,
      onProgress: (progress: { received: number; total: number }) => void,
      _signal: AbortSignal,
      opts: { resume?: boolean; onChecking?: () => void } = {}
    ) {
      resumed.push(opts.resume === true)
      await options.hold
      const contents = options.contents ?? 'rom bytes'
      // The break happens once, on the first attempt: what is being tested is
      // what RomMix does next, and a transfer that never succeeds could never
      // reach it.
      if (options.breakAfter !== undefined && resumed.length <= (options.breakTimes ?? 1)) {
        await writeFile(`${destination}.part`, contents.slice(0, options.breakAfter))
        throw new (options.breakReason ?? RommError)('the transfer from RomM kept breaking off')
      }
      // The real client renames the partial onto the ROM, so it is gone either
      // way once the transfer finishes.
      await rm(`${destination}.part`, { force: true })
      /**
       * Said where the real transfer says it, which is not wherever there is a
       * hash.
       *
       * `fetchToFile` raises this only when it was handed something to verify,
       * and what it is handed is `checksumOf(rom)` — which declines for an
       * archive, RomM having hashed what is inside rather than what the
       * endpoint serves. A fake that announced it anyway put a state in the
       * asserted sequence that the real code never emits for a zipped game,
       * and hid the fact that the check which *does* run for one — after
       * unpacking — left the row saying "Extracting" throughout.
       */
      if (checksumOf(game)) opts.onChecking?.()
      if (options.zip) {
        const inside = scratch()
        for (const [name, body] of Object.entries(options.zip)) {
          writeFileSync(join(inside, name), body)
        }
        const bytes = await zipDirectory(inside, destination)
        onProgress({ received: bytes, total: bytes })
        return
      }
      await writeFile(destination, contents)
      onProgress({ received: contents.length, total: contents.length })
    }
  } as unknown as RommClient
  return { client, resumed }
}

/**
 * An offline cache under whatever scratch root the test has set.
 *
 * The real one rather than a stub: it writes into a throwaway folder and asks
 * the fake client for artwork, which is the same shape as a real install
 * against a server holding no covers.
 */
function cache(client: RommClient): OfflineCache {
  return new OfflineCache(rootPaths().offline, client)
}

/** A manager over a fresh root, with whichever emulator the test wants. */
function manager(
  options: {
    emulator?: EmulatorState | null
    shared?: boolean
    contents?: string
    breakAfter?: number
    ranges?: boolean
    perFile?: boolean
    corruptFile?: number
    zip?: Record<string, string>
    roms?: Record<number, RommRom>
    breakReason?: typeof RommError
    breakTimes?: number
    /** An existing folder to open again, for the case of a restart. */
    store?: Store
    hold?: Promise<void>
  } = {}
): {
  downloads: DownloadManager
  library: Library
  store: Store
  root: string
  client: RommClient
  resumed: boolean[]
} {
  const root = options.store ? resolveRoot() : scratch()
  process.env.GALLEON_HOME = root
  const store = options.store ?? new Store(join(root, 'config'))
  store.updateSettings({ romStorage: options.shared === false ? 'emulator' : 'rommix' })
  const { client, resumed } = fakeClient(options)
  /**
   * The real check, which is the one worth running: it is a hash of a local
   * file and a rule about what RomM's digest describes, and it needs no server
   * at all. A fake standing in for it would only ever agree with itself.
   */
  Object.assign(client, {
    verifyUnpacked: (game: RommRom, path: string) =>
      new RommClient(store).verifyUnpacked(game, path)
  })
  const library = new Library(store, client, cache(client), () => options.emulator ?? null)
  const downloads = queue(store, client, library)
  return { downloads, library, store, root, client, resumed }
}

/**
 * Checking, extracting and installing are still moving: a game is not settled
 * until what came out of the transfer has been checked, unpacked and indexed.
 */
const MOVING = new Set(['queued', 'downloading', 'checking', 'extracting', 'installing'])

/** Run the queue until the item for this ROM stops moving. */
async function settled(downloads: DownloadManager, romId: number): Promise<DownloadItem> {
  const find = (items: DownloadItem[]): DownloadItem | undefined =>
    items.find((row) => row.romId === romId)
  await reached(
    downloads,
    (items) => {
      const item = find(items)
      return item !== undefined && !MOVING.has(item.state)
    },
    `the download of ${romId} settled`
  )
  // And the rest of the turn the queue announced it in. What the queue does in
  // reaction to its own news (the drain leaving its loop, mostly) happens
  // there, and a press from the screen arrives over IPC in a later turn; a
  // test answering inside it would be standing somewhere no caller can.
  await new Promise((resolve) => setImmediate(resolve))
  return find(downloads.items) as DownloadItem
}

describe('the queue', () => {
  test('asking twice for the same game does not queue it twice', async () => {
    const { downloads } = manager()

    await downloads.enqueue(rom())
    await downloads.enqueue(rom())

    assert.equal(downloads.items.filter((item) => item.romId === 1).length, 1)
  })

  test('two presses of the same button are one transfer, not two rows', async () => {
    // Planning reads the disk, so a second ask can arrive while the first is
    // still working one out. Both find nothing queued; without a second look
    // the later one replaces the row the transfer on the wire reports into.
    const { downloads } = manager()

    await Promise.all([downloads.enqueue(rom()), downloads.enqueue(rom())])

    assert.equal(downloads.items.filter((item) => item.romId === 1).length, 1)
  })

  test('cancelling marks the item rather than dropping it off the screen', async () => {
    const { downloads } = manager()
    await downloads.enqueue(rom())

    downloads.cancel(1)

    assert.equal(downloads.items[0].state, 'cancelled')
  })

  test('clearing finished items leaves whatever is still moving', async () => {
    const { downloads } = manager()
    await downloads.enqueue(rom())
    downloads.cancel(1)

    downloads.clearFinished()

    assert.deepEqual(downloads.items, [])
  })

  test('cancelling a game that was never queued does nothing at all', () => {
    const { downloads } = manager()

    downloads.cancel(404)

    assert.deepEqual(downloads.items, [])
  })
})

describe('a download that runs to the end', () => {
  test('the game lands in the index, at the path it was written to', async () => {
    const root = scratch()
    process.env.GALLEON_HOME = root
    const store = new Store(join(root, 'config'))
    const { client } = fakeClient({ contents: '0123456789' })
    const downloads = queue(store, client, new Library(store, client, cache(client), () => null))

    const finished = new Promise<void>((resolve) => {
      downloads.on('update', (items: { state: string }[]) => {
        if (items.some((item) => item.state === 'done' || item.state === 'error')) resolve()
      })
    })
    await downloads.enqueue(rom())
    await finished

    const installed = store.getInstalled(1)
    assert.ok(installed)
    assert.equal(installed.emulatorId, SHARED_LIBRARY)
    assert.equal(installed.system, 'genesis')
    assert.equal(installed.sizeBytes, 10)
    assert.equal(existsSync(installed.path), true)
  })
})

describe('changing the order of the queue', () => {
  /** Three games queued behind one another, the last of them the small one. */
  const three = (): RommRom[] => [
    rom({ id: 1, fs_name: 'One.md', fs_name_no_ext: 'One' }),
    rom({ id: 2, fs_name: 'Two.md', fs_name_no_ext: 'Two' }),
    rom({ id: 3, fs_name: 'Three.md', fs_name_no_ext: 'Three' })
  ]

  /**
   * The same three, as the library the queue fetches them from.
   *
   * Only the first is handed to `enqueue` by the pump — every other item is
   * looked up again when its turn comes, so a queue that is meant to run to the
   * end needs a client that can answer for all of them.
   */
  const library = (): Record<number, RommRom> =>
    Object.fromEntries(three().map((game) => [game.id, game]))

  test('a promoted transfer takes the place of the one on the wire', async () => {
    const { downloads } = manager({ contents: '0123456789', hold: heldWire().held })
    for (const game of three()) await downloads.enqueue(game)
    await onTheWire(downloads, 1)

    downloads.promote(3)

    // Ahead of the transfer it overtook, which is what makes it the next one
    // the queue reaches.
    assert.deepEqual(
      downloads.items.map((item) => item.romId),
      [3, 1, 2]
    )
  })

  test('the transfer it overtook carries on by itself once the other is done', async () => {
    /**
     * `breakAfter` stands in for the interruption.
     *
     * The client here writes its bytes and returns without ever looking at the
     * abort signal, so nothing in this file can stop a transfer mid-flight —
     * that the real one honours the signal is `romm.test.ts`'s subject. What is
     * under test is what the queue does with a transfer that stopped while it
     * was marked as overtaken: where it goes, whether anything has to be
     * pressed to bring it back, and whether it starts again from nothing.
     */
    const wire = heldWire()
    const made = manager({
      contents: '0123456789',
      breakAfter: 4,
      roms: library(),
      hold: wire.held
    })
    for (const game of three()) await made.downloads.enqueue(game)
    await onTheWire(made.downloads, 1)

    made.downloads.promote(3)
    wire.release()
    await reached(
      made.downloads,
      (items) => items.length === 3 && items.every((item) => item.state === 'done'),
      'all three done'
    )

    // Nobody pressed anything: the queue reached it again on its own.
    assert.deepEqual(
      made.downloads.items.map((item) => item.state),
      ['done', 'done', 'done']
    )
    // And picked it up rather than fetching it a second time — exactly one of
    // the four attempts was a resume, which is the one that was overtaken.
    assert.equal(made.resumed.filter(Boolean).length, 1)
  })

  test('a transfer that cannot be resumed is not interrupted', async () => {
    // Nothing to pick up afterwards, so overtaking it would cost everything it
    // has fetched. The promoted game takes the turn after instead.
    const { downloads } = manager({ contents: '0123456789', ranges: false, hold: heldWire().held })
    for (const game of three()) await downloads.enqueue(game)
    await onTheWire(downloads, 1)

    downloads.promote(3)

    assert.equal(downloads.items.find((item) => item.romId === 1)?.state, 'downloading')
  })

  test('a resumed transfer waits behind what is already on the wire', async () => {
    /**
     * Resuming is joining the queue, not jumping it.
     *
     * A transfer restored as paused sits wherever `restorePending` put it,
     * which can be ahead of whatever started in the meantime — and marking it
     * queued in that place made the order of the list disagree with the order
     * it would run in. Every question asked of the queue after that had two
     * answers, and `promote` gave the wrong one: the row said next, the wire
     * said otherwise, and the button that was meant to settle it did nothing.
     */
    const made = manager({ contents: '0123456789', roms: library(), hold: heldWire().held })
    const dir = join(made.root, 'roms', 'genesis')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'Nine.md'), '0'.repeat(8))
    made.store.setPending({
      romId: 9,
      name: 'Nine',
      coverPath: null,
      system: 'genesis',
      platformName: 'Sega Mega Drive',
      targetPath: join(dir, 'Nine.md'),
      files: [],
      ownsFolder: false,
      fileName: 'Nine.md',
      totalBytes: 100
    })
    await made.downloads.restorePending()

    const [one, two] = three()
    await made.downloads.enqueue(one)
    await onTheWire(made.downloads, 1)
    await made.downloads.enqueue(two)
    // Behind everything else waiting, rather than back into the place it held.
    await made.downloads.enqueue(rom({ id: 9, fs_name: 'Nine.md', fs_name_no_ext: 'Nine' }))
    assert.deepEqual(
      made.downloads.items.map((item) => `${item.romId}:${item.state}`),
      ['1:downloading', '2:queued', '9:queued']
    )

    made.downloads.promote(9)

    // The promoted game first, then the transfer it interrupted — which was on
    // the wire, so its turn comes before anything that is only waiting.
    assert.deepEqual(
      made.downloads.items.map((item) => item.romId),
      [9, 1, 2]
    )
  })

  test('a paused game can be told to download now, without being resumed first', async () => {
    /**
     * The button means one thing: this game, now.
     *
     * It used to be offered to queued rows alone, which left a list of paused
     * games with no way to say which of them mattered — resuming one put it at
     * the back of the queue, and there was nothing to press afterwards to bring
     * it forward.
     */
    const made = manager({ contents: '0123456789', roms: library(), hold: heldWire().held })
    for (const game of three()) await made.downloads.enqueue(game)
    await onTheWire(made.downloads, 1)
    made.downloads.pause(3)

    made.downloads.promote(3)

    assert.deepEqual(
      made.downloads.items.map((item) => `${item.romId}:${item.state}`),
      // Interrupted so the promoted game can start, and put directly behind it.
      ['3:queued', '1:downloading', '2:queued']
    )
  })

  test('a paused game promoted with nothing running starts on its own', async () => {
    // Nothing gave way, so nothing would have reached it: `promote` is the only
    // thing that starts the queue here.
    const made = manager({ contents: '0123456789', roms: library() })
    await made.downloads.enqueue(three()[0])
    made.downloads.pause(1)
    await settled(made.downloads, 1)

    made.downloads.promote(1)

    assert.equal((await settled(made.downloads, 1)).state, 'done')
  })

  test('the one already next is left alone, and so is anything not waiting', async () => {
    const { downloads } = manager({ contents: '0123456789', hold: heldWire().held })
    for (const game of three()) await downloads.enqueue(game)
    await onTheWire(downloads, 1)
    const before = downloads.items.map((item) => item.romId)

    // On the wire rather than waiting, so there is nothing to bring forward.
    downloads.promote(1)
    // Not in the queue at all.
    downloads.promote(404)

    assert.deepEqual(
      downloads.items.map((item) => item.romId),
      before
    )
  })
})

describe('waiting for the queue to stop', () => {
  test('it waits for the transfer on the wire and for everything behind it', async () => {
    const games = [
      rom({ id: 1, fs_name: 'One.md', fs_name_no_ext: 'One' }),
      rom({ id: 2, fs_name: 'Two.md', fs_name_no_ext: 'Two' })
    ]
    const wire = heldWire()
    const { downloads } = manager({
      contents: '0123456789',
      roms: Object.fromEntries(games.map((game) => [game.id, game])),
      hold: wire.held
    })
    for (const game of games) await downloads.enqueue(game)
    await onTheWire(downloads, 1)

    let idle = false
    const stopped = downloads.whenIdle().then(() => {
      idle = true
    })
    // A full turn of the event loop, which is more than the queue needs to move
    // on from anything that is not held.
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(idle, false, 'it should still be waiting on the held transfer')

    wire.release()
    await stopped

    // Over, rather than merely past the transfer it was waiting on: the game
    // queued behind it had its turn as well.
    assert.deepEqual(
      downloads.items.map((item) => `${item.romId}:${item.state}`),
      ['1:done', '2:done']
    )
  })

  test('a queue that never started is already idle', async () => {
    const { downloads } = manager()

    await downloads.whenIdle()

    assert.deepEqual(downloads.items, [])
  })
})

describe('a game RomM holds zipped', () => {
  /**
   * The archive, and the digest of the game inside it.
   *
   * RomM opens an archive it recognises and records the hashes of what it found
   * in there, so this is what the ROM carries — and the zip served for it can
   * never hash to it. Every archived game in a library was fetched whole,
   * refused, and deleted as corrupt.
   */
  const zipped = (): RommRom =>
    rom({
      fs_name: 'Advance Wars (Europe).zip',
      fs_name_no_ext: 'Advance Wars (Europe)',
      fs_extension: 'zip',
      md5_hash: '781e5e245d69b566979b86e28d23f2c7',
      files: [{ file_name: 'Advance Wars (Europe).gba' }]
    } as Partial<RommRom>)

  test('the game that comes out of it is what the hash is checked against', async () => {
    const { downloads, store } = manager({
      zip: { 'Advance Wars (Europe).gba': '0123456789' }
    })

    await downloads.enqueue(zipped())
    const item = await settled(downloads, 1)

    assert.equal(item.state, 'done')
    assert.equal(existsSync(store.getInstalled(1)?.path ?? ''), true)
  })

  test('the row says what it is doing after the last byte', async () => {
    const { downloads } = manager({
      zip: { 'Advance Wars (Europe).gba': '0123456789' }
    })
    const seen: string[] = []
    downloads.on('update', (items: DownloadItem[]) => {
      const row = items.find((item) => item.romId === 1)
      if (row && seen.at(-1) !== row.state) seen.push(row.state)
    })

    await downloads.enqueue(zipped())
    await settled(downloads, 1)

    /**
     * A full bar and the word "Downloading" over a game being checked, unpacked
     * and indexed is a transfer that reads as stuck. Each of those says so, in
     * the order they happen, and none of them comes round twice.
     *
     * Checked *after* extracting, for an archive. RomM hashes what is inside
     * one rather than the archive the endpoint serves, so the wire-side check
     * declines and the digest only has the file it describes in front of it
     * once the game is unpacked — which is a read of the whole ROM back off the
     * disk, and minutes of it on a large game. The order here is the one thing
     * that says which of the two checks a zipped game actually gets.
     */
    assert.deepEqual(seen, [
      'queued',
      'downloading',
      'extracting',
      'checking',
      'installing',
      'done'
    ])
  })

  test('a game served as a plain file is checked on the way in instead', async () => {
    // The other side of the order above, and the reason it is worth asserting:
    // for a game RomM did not have to open, the digest describes the bytes on
    // the wire, so the check happens before anything is unpacked — there being
    // nothing to unpack.
    const { downloads } = manager()
    const seen: string[] = []
    downloads.on('update', (items: DownloadItem[]) => {
      const row = items.find((item) => item.romId === 1)
      if (row && seen.at(-1) !== row.state) seen.push(row.state)
    })

    await downloads.enqueue(rom({ md5_hash: '781e5e245d69b566979b86e28d23f2c7' }))
    await settled(downloads, 1)

    assert.deepEqual(seen, ['queued', 'downloading', 'checking', 'installing', 'done'])
  })

  test('one that unpacks to bytes RomM does not hold is refused, and goes', async () => {
    const made = manager({ zip: { 'Advance Wars (Europe).gba': 'not that game at all' } })

    await made.downloads.enqueue(zipped())
    const item = await settled(made.downloads, 1)

    assert.equal(item.state, 'error')
    assert.ok(item.error, 'the row has to say why it was thrown away')
    // Nothing is left under the name an emulator would load it by, and nothing
    // is recorded as installed.
    assert.equal(existsSync(join(made.root, 'roms', 'genesis', 'Advance Wars (Europe).gba')), false)
    assert.equal(made.store.getInstalled(1), undefined)
  })
})

describe('an arcade game', () => {
  /**
   * A romset, as RomM holds one: a zip named after the set, and the hashes of
   * the chip dumps inside it.
   *
   * The archive is the game here — MAME and FinalBurn Neo are handed it whole —
   * so it is the one zip RomMix downloads and does not open.
   */
  const romset = (): RommRom =>
    rom({
      fs_name: 'mslug.zip',
      fs_name_no_ext: 'mslug',
      fs_extension: 'zip',
      platform_slug: 'arcade',
      platform_fs_slug: 'arcade',
      platform_display_name: 'Arcade',
      md5_hash: '781e5e245d69b566979b86e28d23f2c7',
      files: [{ file_name: 'mslug.zip' }]
    } as Partial<RommRom>)

  test('the archive is installed as it arrived rather than unpacked', async () => {
    const { downloads, store, root } = manager({
      zip: { '201-c1.c1': 'the graphics rom' }
    })

    await downloads.enqueue(romset())
    const item = await settled(downloads, 1)

    assert.equal(item.state, 'done')
    // The name an arcade emulator looks the set up by, still a file.
    assert.equal(store.getInstalled(1)?.path, join(root, 'roms', 'arcade', 'mslug.zip'))
    assert.equal(store.getInstalled(1)?.isDirectory, false)
    assert.deepEqual(await readdir(join(root, 'roms', 'arcade')), ['mslug.zip'])
  })

  test('the row never says it is extracting one', async () => {
    const { downloads } = manager({ zip: { '201-c1.c1': 'the graphics rom' } })
    const seen: string[] = []
    downloads.on('update', (items: DownloadItem[]) => {
      const row = items.find((item) => item.romId === 1)
      if (row && seen.at(-1) !== row.state) seen.push(row.state)
    })

    await downloads.enqueue(romset())
    await settled(downloads, 1)

    // Nor checking: RomM hashed the dumps inside the archive, and the archive
    // is what is kept, so there is nothing the digest describes.
    assert.deepEqual(seen, ['queued', 'downloading', 'installing', 'done'])
  })
})

describe('a download that is interrupted', () => {
  test('what arrived is kept, and the row waits to be finished rather than failing', async () => {
    const { downloads, store, root } = manager({ contents: '0123456789', breakAfter: 4 })

    await downloads.enqueue(rom())
    const item = await settled(downloads, 1)

    assert.equal(item.state, 'paused')
    assert.equal(item.error, null)
    assert.equal(item.receivedBytes, 4)
    const partial = join(root, 'roms', 'genesis', 'Sonic the Hedgehog (USA).md.part')
    assert.equal(readFileSync(partial, 'utf8'), '0123')
    // Recorded, so a restart still knows whose bytes those are.
    assert.deepEqual(
      store.pending.map((row) => row.romId),
      [1]
    )
  })

  test('a transfer that never delivered anything is an error, not something to resume', async () => {
    const { downloads, store } = manager({ contents: '0123456789', breakAfter: 0 })

    await downloads.enqueue(rom())
    const item = await settled(downloads, 1)

    assert.equal(item.state, 'error')
    assert.ok(item.error)
    assert.deepEqual(store.pending, [])
  })

  test('asking for the game again continues it rather than starting over', async () => {
    const { downloads, store, resumed } = manager({ contents: '0123456789', breakAfter: 4 })
    await downloads.enqueue(rom())
    await settled(downloads, 1)

    await downloads.enqueue(rom())
    const item = await settled(downloads, 1)

    assert.equal(item.state, 'done')
    assert.deepEqual(resumed, [false, true])
    // Finished, so there is nothing left to pick up.
    assert.deepEqual(store.pending, [])
    assert.ok(store.getInstalled(1))
  })

  test('a ROM the server has replaced since is fetched again, not appended to', async () => {
    const { downloads, store, resumed } = manager({ contents: '0123456789', breakAfter: 4 })
    await downloads.enqueue(rom())
    await settled(downloads, 1)

    // A better dump, uploaded under the same id: a different file name, so the
    // bytes on disk are not this ROM's.
    await downloads.enqueue(rom({ fs_name: 'Sonic the Hedgehog (USA) (Rev 1).md' }))
    await settled(downloads, 1)

    assert.deepEqual(resumed, [false, false])
    assert.deepEqual(store.pending, [])
  })

  test('the same ROM reported at a slightly different size is still the same ROM', async () => {
    const { downloads, resumed } = manager({ contents: '0123456789', breakAfter: 4 })
    await downloads.enqueue(rom())
    await settled(downloads, 1)

    // RomM derives `fs_size_bytes` rather than storing it, and answers with a
    // figure a few hundred bytes different from one call to the next. Treating
    // that as a different file threw the partial away every time.
    await downloads.enqueue(rom({ fs_size_bytes: 511 }))
    const item = await settled(downloads, 1)

    assert.equal(item.state, 'done')
    assert.deepEqual(resumed, [false, true])
  })

  test('cancelling is what throws the part-downloaded file away', async () => {
    const { downloads, store, root } = manager({ contents: '0123456789', breakAfter: 4 })
    await downloads.enqueue(rom())
    await settled(downloads, 1)

    await downloads.cancel(1)

    const partial = join(root, 'roms', 'genesis', 'Sonic the Hedgehog (USA).md.part')
    assert.equal(existsSync(partial), false)
    assert.deepEqual(store.pending, [])
    assert.equal(downloads.items[0].state, 'cancelled')
  })

  test('clearing the finished ones leaves it alone: it has not finished', async () => {
    const { downloads } = manager({ contents: '0123456789', breakAfter: 4 })
    await downloads.enqueue(rom())
    await settled(downloads, 1)

    downloads.clearFinished()

    assert.deepEqual(
      downloads.items.map((item) => item.state),
      ['paused']
    )
  })
})

describe('after a restart', () => {
  test('an interrupted download is back in the list, at the size on disk', async () => {
    const { downloads, store, root } = manager({ contents: '0123456789', breakAfter: 4 })
    await downloads.enqueue(rom())
    await settled(downloads, 1)

    // A second manager over the same root is what a restart looks like from
    // here: same files, same store, nothing in memory.
    const { client } = fakeClient()
    const next = queue(store, client, new Library(store, client, cache(client), () => null))
    await next.restorePending()

    const [item] = next.items
    assert.equal(item.state, 'paused')
    assert.equal(item.receivedBytes, 4)
    assert.equal(
      store.pending[0].targetPath,
      join(root, 'roms', 'genesis', 'Sonic the Hedgehog (USA).md')
    )
  })

  test('a partial the user deleted by hand is forgotten rather than offered', async () => {
    const { downloads, store, root } = manager({ contents: '0123456789', breakAfter: 4 })
    await downloads.enqueue(rom())
    await settled(downloads, 1)
    rmSync(join(root, 'roms', 'genesis', 'Sonic the Hedgehog (USA).md.part'))

    const { client } = fakeClient()
    const next = queue(store, client, new Library(store, client, cache(client), () => null))
    await next.restorePending()

    assert.deepEqual(next.items, [])
    assert.deepEqual(store.pending, [])
  })

  test('resuming after a restart continues the file rather than starting over', async () => {
    const { downloads, store } = manager({ contents: '0123456789', breakAfter: 4 })
    await downloads.enqueue(rom())
    await settled(downloads, 1)

    // The restart: a new manager over the same root, told to pick up what was
    // left, then asked for the same game again.
    const { client, resumed } = fakeClient({ contents: '0123456789', roms: { 1: rom() } })
    const next = queue(store, client, new Library(store, client, cache(client), () => null))
    await next.restorePending()
    await next.enqueue(rom())
    const item = await settled(next, 1)

    assert.equal(item.state, 'done')
    assert.deepEqual(resumed, [true])
  })

  test('a transfer RomMix was killed during is offered again, not lost', async () => {
    // No pause, no failure, no cleanup: the process simply stops, which is what
    // a desktop closing it or a machine losing power looks like. The bytes and
    // the record both have to be on disk already for this to survive.
    const root = scratch()
    process.env.GALLEON_HOME = root
    const store = new Store(join(root, 'config'))
    // Never let go while the test runs, which is what a process that has
    // stopped looks like from the disk.
    const wire = heldWire()
    let wrote!: () => void
    const partWritten = new Promise<void>((resolve) => {
      wrote = resolve
    })
    const client = {
      async supportsRange() {
        return true
      },
      async fileTransfers() {
        return { available: false, resumable: true }
      },
      async rom() {
        return rom()
      },
      async downloadRom(_rom: RommRom, destination: string) {
        await writeFile(`${destination}.part`, '0123')
        wrote()
        await wire.held
      }
    } as unknown as RommClient
    const killed = queue(store, client, new Library(store, client, cache(client), () => null))
    await killed.enqueue(rom())
    await partWritten

    const { client: next, resumed } = fakeClient({ contents: '0123456789', roms: { 1: rom() } })
    const restarted = queue(store, next, new Library(store, next, cache(next), () => null))
    await restarted.restorePending()

    const [restored] = restarted.items
    assert.equal(restored.state, 'paused')
    assert.equal(restored.receivedBytes, 4)

    await restarted.enqueue(rom())
    assert.equal((await settled(restarted, 1)).state, 'done')
    assert.deepEqual(resumed, [true])
  })

  test('what the network stopped is picked up again when the server is back', async () => {
    const second = rom({ id: 2, fs_name: 'Streets of Rage (USA).md' })
    // Both transfers break, which is what one network going away looks like:
    // the one on the wire and the one that starts the moment it stops.
    const { downloads } = manager({
      contents: '0123456789',
      breakAfter: 4,
      breakTimes: 2,
      breakReason: UnreachableError,
      roms: { 1: rom(), 2: second }
    })

    await downloads.enqueue(rom())
    await downloads.enqueue(second)
    await settled(downloads, 1)
    await settled(downloads, 2)

    assert.deepEqual(
      downloads.items.map((item) => item.state),
      ['stalled', 'stalled']
    )

    // The fake breaks twice and no more, so this is the server having come back.
    assert.equal(await downloads.resumeAfterOutage(), 2)
    assert.equal((await settled(downloads, 1)).state, 'done')
    assert.equal((await settled(downloads, 2)).state, 'done')
  })

  test('an outage that outlived RomMix is still an outage on the next start', async () => {
    // Out of range, and then closed: the row goes with the process, and all
    // that is left is the record beside the bytes.
    const stopped = manager({
      contents: '0123456789',
      breakAfter: 4,
      breakReason: UnreachableError,
      roms: { 1: rom() }
    })
    const { store } = stopped
    await stopped.downloads.enqueue(rom())
    await settled(stopped.downloads, 1)
    assert.equal(store.pending[0].stoppedAs, 'stalled')

    // Opened again at home, where there is a server. Nothing was pressed.
    const restarted = manager({ contents: '0123456789', roms: { 1: rom() }, store })
    assert.equal(await restarted.downloads.resumeAfterOutage(), 1)
    assert.equal((await settled(restarted.downloads, 1)).state, 'done')
  })

  test('a transfer the user paused is not picked up again', async () => {
    const second = rom({ id: 2, fs_name: 'Streets of Rage (USA).md' })
    const { downloads } = manager({ contents: '0123456789', roms: { 1: rom(), 2: second } })

    await downloads.enqueue(rom())
    await downloads.enqueue(second)
    downloads.pause(2)

    // Stopping was the answer, not the problem. A queue that undid it the
    // moment the network hiccupped would be a Pause button that does not.
    const paused = downloads.items.find((item) => item.romId === 2)
    assert.equal(paused?.state, 'paused')
    assert.equal(await downloads.resumeAfterOutage(), 0)
  })

  test('a transfer that failed for a reason waiting cannot fix stays failed', async () => {
    const { downloads } = manager({
      contents: '0123456789',
      breakAfter: 0,
      breakReason: RommError,
      roms: { 1: rom() }
    })

    await downloads.enqueue(rom())
    await settled(downloads, 1)

    // An unsafe name and a refused hash are not the network, and coming back
    // into range fixes neither.
    assert.equal(downloads.items[0].state, 'error')
    assert.equal(await downloads.resumeAfterOutage(), 0)
  })

  test('a ROM the server answers 404 for is a failure, not an outage', async () => {
    const root = scratch()
    process.env.GALLEON_HOME = root
    const store = new Store(join(root, 'config'))
    const reachable: boolean[] = []

    /**
     * The real transfer path, against a server that answers.
     *
     * The point of going through `RommClient` rather than a fake `downloadRom`:
     * every status RomM replies with lands in the same retry loop as a broken
     * connection, and a non-resumable transfer is allowed one attempt — so a
     * 404 arrives exactly where an outage would. Told apart wrongly, it would
     * report a server that had just answered as unreachable, put the whole
     * interface into offline mode, and come back for the same 404 on every
     * reconnection.
     */
    const client = new RommClient(store)
    client.observeReachability((up) => reachable.push(up))
    Object.assign(client, {
      supportsRange: async () => false,
      fileTransfers: async () => ({ available: false, resumable: false }),
      rom: async () => rom(),
      asset: async () => new Response(null, { status: 404 })
    })
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => new Response('no such ROM', { status: 404 })
    store.setServer({ baseUrl: 'https://romm.example', authMode: 'token' })

    try {
      const library = new Library(store, client, cache(client), () => null)
      const downloads = queue(store, client, library)
      await downloads.enqueue(rom())
      const item = await settled(downloads, 1)

      assert.equal(item.state, 'error')
      assert.notEqual(item.error, null)
      assert.equal(await downloads.resumeAfterOutage(), 0)
      // The server answered, so nothing here said it was gone.
      assert.equal(reachable.includes(false), false)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('a game the server will not describe is left marked for next time', async () => {
    const { downloads } = manager({
      contents: '0123456789',
      breakAfter: 4,
      breakReason: UnreachableError,
      // No entry for it, so asking the server about it again fails.
      roms: {}
    })

    await downloads.enqueue(rom())
    await settled(downloads, 1)
    assert.equal(downloads.items[0].state, 'stalled')

    assert.equal(await downloads.resumeAfterOutage(), 0)
    // Still stalled, so the next time the server answers takes it up again
    // rather than the row being quietly abandoned.
    assert.equal(downloads.items[0].state, 'stalled')
  })

  test('a pause after a stall survives the next start', async () => {
    const second = rom({ id: 2, fs_name: 'Streets of Rage (USA).md' })
    const stopped = manager({
      contents: '0123456789',
      breakAfter: 4,
      breakTimes: 2,
      breakReason: UnreachableError,
      roms: { 1: rom(), 2: second }
    })
    await stopped.downloads.enqueue(rom())
    await stopped.downloads.enqueue(second)
    await settled(stopped.downloads, 1)
    await settled(stopped.downloads, 2)

    // Picked up when the server came back, and then stopped on purpose while
    // it waited its turn behind the other one.
    await stopped.downloads.resumeAfterOutage()
    stopped.downloads.pause(2)
    assert.equal(stopped.store.pending.find((row) => row.romId === 2)?.stoppedAs, 'paused')

    const restarted = manager({
      contents: '0123456789',
      roms: { 1: rom(), 2: second },
      store: stopped.store
    })
    await restarted.downloads.restorePending()

    // Anything else is a Pause button that a restart undoes.
    assert.equal(restarted.downloads.items.find((item) => item.romId === 2)?.state, 'paused')
  })

  test('a game that finished after all is forgotten rather than offered again', async () => {
    // RomMix stopped between the last byte landing and the record being
    // cleared: the game is installed, and the record is the only thing left.
    const { downloads, store } = manager({ contents: '0123456789' })
    await downloads.enqueue(rom())
    await settled(downloads, 1)
    store.setPending({
      romId: 1,
      name: 'Sonic the Hedgehog',
      coverPath: null,
      system: 'genesis',
      platformName: 'Sega Mega Drive',
      targetPath: store.getInstalled(1)!.path,
      files: [],
      ownsFolder: false,
      fileName: 'Sonic the Hedgehog (USA).md',
      totalBytes: 10
    })

    const { client } = fakeClient()
    const next = queue(store, client, new Library(store, client, cache(client), () => null))
    await next.restorePending()

    assert.deepEqual(next.items, [])
    assert.deepEqual(store.pending, [])
  })

  test('restoring twice does not put the same transfer in the list twice', async () => {
    const { downloads, store } = manager({ contents: '0123456789', breakAfter: 4 })
    await downloads.enqueue(rom())
    await settled(downloads, 1)

    const { client } = fakeClient()
    const next = queue(store, client, new Library(store, client, cache(client), () => null))
    await next.restorePending()
    await next.restorePending()

    assert.equal(next.items.length, 1)
  })
})

describe('pausing on purpose', () => {
  test('a transfer stopped by the user keeps what it had, and is not an error', async () => {
    // The client waits to be aborted rather than finishing, which is what a
    // transfer in progress looks like at the moment the button is pressed.
    const root = scratch()
    process.env.GALLEON_HOME = root
    const store = new Store(join(root, 'config'))
    const client = {
      async supportsRange() {
        return true
      },
      async fileTransfers() {
        return { available: false, resumable: true }
      },
      async rom(id: number) {
        throw new RommError(`no ROM ${id}`)
      },
      async downloadRom(
        _rom: RommRom,
        destination: string,
        onProgress: (progress: { received: number; total: number }) => void,
        signal: AbortSignal
      ) {
        await writeFile(`${destination}.part`, '0123')
        onProgress({ received: 4, total: 10 })
        await new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new RommError('aborted')), { once: true })
          underway()
        })
      }
    } as unknown as RommClient
    let underway!: () => void
    const listening = new Promise<void>((resolve) => {
      underway = resolve
    })
    const downloads = queue(store, client, new Library(store, client, cache(client), () => null))

    await downloads.enqueue(rom())
    // Part-way, and waiting on the button: the bytes have landed and the abort
    // has somewhere to go.
    await listening
    downloads.pause(1)
    const item = await settled(downloads, 1)

    assert.equal(item.state, 'paused')
    assert.equal(item.error, null)
    assert.equal(item.receivedBytes, 4)
    assert.equal(
      readFileSync(join(root, 'roms', 'genesis', 'Sonic the Hedgehog (USA).md.part'), 'utf8'),
      '0123'
    )
    assert.deepEqual(
      store.pending.map((row) => row.romId),
      [1]
    )
  })

  test('a transfer still waiting its turn pauses without ever starting', async () => {
    const root = scratch()
    process.env.GALLEON_HOME = root
    const store = new Store(join(root, 'config'))
    const second = rom({ id: 2, fs_name: 'Streets of Rage (USA).md' })
    // The first transfer never finishes, so the second stays queued behind it —
    // which is the state this is about. Waiting for the first to be on the wire
    // means its own record is already written, so what is left to see is
    // whether the second one wrote one too.
    const wire = heldWire()
    let onWire!: () => void
    const firstOnWire = new Promise<void>((resolve) => {
      onWire = resolve
    })
    const client = {
      async supportsRange() {
        return true
      },
      async fileTransfers() {
        return { available: false, resumable: true }
      },
      async rom() {
        return second
      },
      async downloadRom() {
        onWire()
        await wire.held
      }
    } as unknown as RommClient
    const downloads = queue(store, client, new Library(store, client, cache(client), () => null))
    await downloads.enqueue(rom())
    await downloads.enqueue(second)
    await firstOnWire

    downloads.pause(2)

    const queuedItem = downloads.items.find((item) => item.romId === 2)
    assert.equal(queuedItem?.state, 'paused')
    assert.equal(queuedItem?.receivedBytes, 0)
    // Nothing of the second arrived, so it has nothing to remember between runs.
    assert.deepEqual(
      store.pending.map((entry) => entry.romId),
      [1]
    )
  })

  test('pausing something that is not moving does nothing at all', async () => {
    const { downloads } = manager({ contents: '0123456789' })
    await downloads.enqueue(rom())
    await settled(downloads, 1)

    downloads.pause(1)
    downloads.pause(404)

    assert.equal(downloads.items[0].state, 'done')
  })
})

describe('a ROM the server cannot send in pieces', () => {
  test('what arrived is thrown away rather than offered as resumable', async () => {
    // RomM zips a multi-file game for each request, so there is no file to
    // seek into and nothing a second attempt could carry on from.
    const { downloads, store, root } = manager({
      contents: '0123456789',
      breakAfter: 4,
      ranges: false
    })

    await downloads.enqueue(rom())
    const item = await settled(downloads, 1)

    assert.equal(item.state, 'error')
    assert.equal(item.resumable, false)
    assert.equal(
      existsSync(join(root, 'roms', 'genesis', 'Sonic the Hedgehog (USA).md.part')),
      false
    )
    assert.deepEqual(store.pending, [])
  })

  test('one that arrives whole is recorded like any other', async () => {
    const { downloads, store } = manager({ contents: '0123456789', ranges: false })

    await downloads.enqueue(rom())
    const item = await settled(downloads, 1)

    assert.equal(item.state, 'done')
    assert.ok(store.getInstalled(1))
  })
})

describe('a game fetched one file at a time', () => {
  /** A game of three files, as RomM describes one. */
  function multi(): RommRom {
    return rom({
      id: 2,
      name: 'Castlevania: Symphony of the Night',
      fs_name: 'Castlevania - Symphony of the Night (Europe)',
      fs_name_no_ext: 'Castlevania - Symphony of the Night (Europe)',
      fs_extension: '',
      has_multiple_files: true,
      platform_slug: 'psx',
      platform_fs_slug: 'psx',
      files: [
        { id: 1, rom_id: 2, file_name: 'disc (Track 1).bin', file_size_bytes: 64 },
        { id: 2, rom_id: 2, file_name: 'disc (Track 2).bin', file_size_bytes: 32 },
        { id: 3, rom_id: 2, file_name: 'disc.cue', file_size_bytes: 8 }
      ] as RommRom['files']
    })
  }

  test('the files land in the game folder, with nothing to unpack', async () => {
    const { downloads, store, root } = manager({ perFile: true })

    await downloads.enqueue(multi())
    const item = await settled(downloads, 2)

    assert.equal(item.state, 'done')
    const dir = join(root, 'roms', 'psx', 'Castlevania - Symphony of the Night (Europe)')
    assert.deepEqual((await readdir(dir)).sort(), [
      'disc (Track 1).bin',
      'disc (Track 2).bin',
      'disc.cue'
    ])
    const installed = store.getInstalled(2)
    assert.equal(installed?.isDirectory, true)
    // The descriptor, not the largest track.
    assert.equal(installed?.launchPath, join(dir, 'disc.cue'))
    assert.equal(installed?.sizeBytes, 104)
  })

  test('a file name that climbs out of the game folder is refused, not followed', async () => {
    /**
     * A multi-file game is the one download that writes under names RomM chose
     * one at a time, joined onto the folder the game was planned into. The
     * server is the user's own, so this is not a stranger's input — but where a
     * file lands is RomMix's to decide, and a name that decides it instead is
     * refused rather than trimmed to something writable.
     */
    const { downloads, root } = manager({ perFile: true })
    const escaping = multi()
    escaping.files = [
      { id: 1, rom_id: 2, file_name: '../../escaped.desktop', file_size_bytes: 64 },
      { id: 2, rom_id: 2, file_name: 'disc.cue', file_size_bytes: 8 }
    ] as RommRom['files']

    await downloads.enqueue(escaping)
    const item = await settled(downloads, 2)

    // Nothing arrived, so there is nothing to resume and this is an error
    // rather than a pause — and the row names the file it refused.
    assert.equal(item.state, 'error')
    assert.match(item.error ?? '', /escaped\.desktop/)
    assert.equal(existsSync(join(root, 'roms', 'escaped.desktop')), false)
  })

  test('a name that was refused is not measured or deleted either', async () => {
    /**
     * The write is the obvious half. The other two are the record.
     *
     * `runOne` writes the file names into the pending record before any of them
     * is checked, and both `bytesHeld` and `discardHeld` rebuild paths from
     * that record. So a refused name was still stat-ed — finding the user's own
     * file, and counting its size as bytes received — and still handed to `rm`
     * when the row was cancelled.
     */
    const { downloads, root } = manager({ perFile: true })
    // Where `../../` from the game's own folder lands.
    const outside = join(root, 'roms', 'a-file-of-the-users-own')
    mkdirSync(join(root, 'roms'), { recursive: true })
    writeFileSync(outside, 'not part of any download')

    const escaping = multi()
    escaping.files = [
      { id: 1, rom_id: 2, file_name: '../../a-file-of-the-users-own', file_size_bytes: 64 },
      { id: 2, rom_id: 2, file_name: 'disc.cue', file_size_bytes: 8 }
    ] as RommRom['files']

    await downloads.enqueue(escaping)
    await settled(downloads, 2)
    downloads.cancel(2)
    // The removal is asynchronous; the row reaching `cancelled` is what says it
    // is done.
    await settled(downloads, 2)

    assert.equal(
      existsSync(outside),
      true,
      'a name the transfer refused must not be one the cancel deletes'
    )
  })

  test('a file refused for its hash pauses the game, and the row says so', async () => {
    /**
     * The rest of the game is real and worth keeping, so this pauses rather
     * than failing — and pausing silently would be the one way for bytes to be
     * thrown away without the screen ever mentioning it. Resuming re-fetches
     * the refused file, whose part-file `verify` took with it.
     */
    const { downloads, store, root } = manager({ perFile: true, corruptFile: 2 })

    await downloads.enqueue(multi())
    const item = await settled(downloads, 2)

    assert.equal(item.state, 'paused')
    assert.ok(item.error, 'the row has to carry the reason, not just say "paused"')
    // The first file arrived and is kept; the refused one is gone.
    const dir = join(root, 'roms', 'psx', 'Castlevania - Symphony of the Night (Europe)')
    assert.deepEqual(await readdir(dir), ['disc (Track 1).bin'])
    // Still recorded, so the row can be finished later.
    assert.deepEqual(
      store.pending.map((row) => row.romId),
      [2]
    )
  })

  test('a connection that broke with bytes worth keeping has nothing to report', async () => {
    // The counterpart to the check above: this row is waiting to be finished,
    // not failing, so it says only that it is paused.
    const { downloads } = manager({ perFile: true, breakAfter: 4 })

    await downloads.enqueue(multi())
    const item = await settled(downloads, 2)

    assert.equal(item.state, 'paused')
    assert.equal(item.error, null)
  })

  test('progress counts every file, not each one from zero', async () => {
    const { downloads } = manager({ perFile: true })
    const seen: number[] = []
    downloads.on('update', (items: DownloadItem[]) => {
      const row = items.find((item) => item.romId === 2)
      if (row) seen.push(row.receivedBytes)
    })

    await downloads.enqueue(multi())
    await settled(downloads, 2)

    // Never goes backwards, and ends at the sum of the three.
    assert.deepEqual(
      [...seen].sort((a, b) => a - b),
      seen
    )
    assert.equal(seen.at(-1), 104)
  })

  test('the row names the file that is arriving, and stops when none is', async () => {
    const { downloads } = manager({ perFile: true })
    const named: (string | undefined)[] = []
    downloads.on('update', (items: DownloadItem[]) => {
      const row = items.find((item) => item.romId === 2)
      if (row) named.push(row.currentFile)
    })

    await downloads.enqueue(multi())
    const item = await settled(downloads, 2)

    assert.deepEqual(
      [...new Set(named.filter(Boolean))],
      ['disc (Track 1).bin', 'disc (Track 2).bin', 'disc.cue']
    )
    // Nothing is arriving once it is installed.
    assert.equal(item.currentFile, undefined)
  })

  test('a transfer that stops naming no file at all', async () => {
    const { downloads } = manager({ perFile: true, breakAfter: 4 })

    await downloads.enqueue(multi())
    const item = await settled(downloads, 2)

    assert.equal(item.state, 'paused')
    // The row would otherwise go on claiming a track is arriving, including
    // after a restart, where the record it is rebuilt from never knew of one.
    assert.equal(item.currentFile, undefined)
  })

  test('a game for an emulator that reads flat lands loose, and says which files', async () => {
    /**
     * Eden and anything else with `flatLibrary`.
     *
     * A folder is a place these emulators' game lists never look, so the files
     * go beside every other game on the platform — and then the only record of
     * which of them are this game is the one written here. Uninstalling reads
     * it: get it wrong and either the game half goes or a neighbour does.
     */
    const roms = scratch()
    const made = manager({
      perFile: true,
      shared: false,
      emulator: {
        id: 'eden',
        name: 'Eden',
        available: true,
        install: null,
        configDir: null,
        dataDir: null,
        unavailableReason: null,
        paths: { home: roms, roms, saves: roms, states: roms, bios: roms }
      } as unknown as EmulatorState
    })

    await made.downloads.enqueue(multi())
    const item = await settled(made.downloads, 2)

    assert.equal(item.state, 'done')
    const installed = made.store.getInstalled(2)
    assert.equal(installed?.isDirectory, false)
    assert.deepEqual(installed?.files.sort(), [
      'disc (Track 1).bin',
      'disc (Track 2).bin',
      'disc.cue'
    ])
  })

  test('a file already there in full is not fetched twice', async () => {
    const { downloads, store, root, resumed } = manager({ perFile: true })
    const dir = join(root, 'roms', 'psx', 'Castlevania - Symphony of the Night (Europe)')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'disc (Track 1).bin'), '0'.repeat(64))
    // The record is what says those bytes are this game's.
    store.setPending({
      romId: 2,
      name: 'Castlevania: Symphony of the Night',
      coverPath: null,
      system: 'psx',
      platformName: 'Sony PlayStation',
      fileName: 'Castlevania - Symphony of the Night (Europe)',
      targetPath: dir,
      files: ['disc (Track 1).bin', 'disc (Track 2).bin', 'disc.cue'],
      ownsFolder: true,
      totalBytes: 104
    })

    await downloads.enqueue(multi())
    await settled(downloads, 2)

    // Two fetched, the third left alone.
    assert.equal(resumed.length, 2)
  })

  test('a game part-way through is not adopted as one already installed', async () => {
    const { library, store, root } = manager({ perFile: true })
    const dir = join(root, 'roms', 'psx', 'Castlevania - Symphony of the Night (Europe)')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'disc (Track 1).bin'), '0'.repeat(64))
    store.setPending({
      romId: 2,
      name: 'Castlevania: Symphony of the Night',
      coverPath: null,
      system: 'psx',
      platformName: 'Sony PlayStation',
      targetPath: dir,
      files: ['disc (Track 1).bin'],
      ownsFolder: true,
      fileName: 'Castlevania - Symphony of the Night (Europe)',
      totalBytes: 104
    })

    assert.deepEqual(await library.adopt([multi()]), [])
    assert.equal(store.getInstalled(2), undefined)
  })

  test('cancelling takes the folder as well as the files in it', async () => {
    const { downloads, store, root } = manager({ perFile: true, breakAfter: 4 })
    await downloads.enqueue(multi())
    await settled(downloads, 2)
    const dir = join(root, 'roms', 'psx', 'Castlevania - Symphony of the Night (Europe)')
    assert.equal(existsSync(dir), true)

    await downloads.cancel(2)

    // An empty directory named after a game is what `adopt` reads as a
    // multi-file game already on disk.
    assert.equal(existsSync(dir), false)
    assert.deepEqual(store.pending, [])
  })

  test('a folder left empty is noticed by a sync, and not adopted again', async () => {
    // The state a cancelled transfer used to leave behind: an index entry, and
    // a folder with nothing in it. Both halves have to be settled — dropping
    // the entry alone would let the next pass adopt the folder straight back.
    const multiRom = multi()
    const { library, store, root } = manager({ perFile: true, roms: { 2: multiRom } })
    const dir = join(root, 'roms', 'psx', 'Castlevania - Symphony of the Night (Europe)')
    mkdirSync(dir, { recursive: true })
    store.addInstalled({
      romId: 2,
      path: dir,
      launchPath: dir,
      name: 'Castlevania: Symphony of the Night',
      coverPath: null,
      files: [],
      system: 'psx',
      platformName: 'Sony PlayStation',
      sizeBytes: 0,
      installedAt: '2026-08-28T00:00:00.000Z',
      isDirectory: true,
      emulatorId: SHARED_LIBRARY
    })

    const result = await library.sync()

    assert.equal(result.removed, 1)
    assert.equal(result.adopted, 0)
    assert.equal(store.getInstalled(2), undefined)
    // Nothing was deleted: the folder is the user's to keep or clear out.
    assert.equal(existsSync(dir), true)
  })

  test('an empty folder left by something else is not adopted as a game', async () => {
    const { library, store, root } = manager({ perFile: true })
    mkdirSync(join(root, 'roms', 'psx', 'Castlevania - Symphony of the Night (Europe)'), {
      recursive: true
    })

    assert.deepEqual(await library.adopt([multi()]), [])
    assert.equal(store.getInstalled(2), undefined)
  })

  test('cancelling a game filed loose takes its files and leaves the folder', async () => {
    // A flat library: the game's files sit in the system folder beside every
    // other game on the platform, so the folder is nobody's to delete.
    const { downloads, store, root } = manager({ perFile: true })
    const dir = join(root, 'roms', 'switch')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'game.nsp'), '0'.repeat(64))
    writeFileSync(join(dir, 'someone-elses.nsp'), 'x')
    store.setPending({
      romId: 2,
      name: 'A Switch game',
      coverPath: null,
      system: 'switch',
      platformName: 'Nintendo Switch',
      targetPath: dir,
      files: ['game.nsp', 'update.nsp'],
      ownsFolder: false,
      fileName: 'A Switch game',
      totalBytes: 104
    })
    await downloads.restorePending()

    await downloads.cancel(2)

    assert.equal(existsSync(join(dir, 'game.nsp')), false)
    assert.equal(existsSync(join(dir, 'someone-elses.nsp')), true)
    assert.equal(existsSync(dir), true)
    assert.deepEqual(store.pending, [])
  })

  test('what a cancelled transfer took with it is not adopted from a stale reading', async () => {
    const { downloads, library, store, root } = manager()
    const dir = join(root, 'roms', 'switch')
    mkdirSync(dir, { recursive: true })
    // Already fetched when the transfer was stopped: a real file, under the
    // name the server has for it.
    writeFileSync(join(dir, 'game.nsp'), '0'.repeat(64))
    store.setPending({
      romId: 2,
      name: 'A Switch game',
      coverPath: null,
      system: 'switch',
      platformName: 'Nintendo Switch',
      targetPath: dir,
      files: ['game.nsp'],
      ownsFolder: false,
      fileName: 'A Switch game',
      totalBytes: 104
    })
    await downloads.restorePending()

    const switchRom = (fields: Partial<RommRom>): RommRom =>
      rom({
        platform_slug: 'switch',
        platform_fs_slug: 'switch',
        fs_extension: 'nsp',
        ...fields
      })

    // A page that reads the folder and finds nothing of its own, which is what
    // leaves a reading of it behind.
    assert.deepEqual(
      await library.adopt([
        switchRom({ id: 8, fs_name: 'elsewhere.nsp', fs_name_no_ext: 'elsewhere' })
      ]),
      []
    )

    await downloads.cancel(2)

    // The bytes are gone, so the game is not on this device — whatever a
    // reading taken before the cancellation still says.
    assert.deepEqual(
      await library.adopt([switchRom({ id: 9, fs_name: 'game.nsp', fs_name_no_ext: 'game' })]),
      []
    )
    assert.equal(store.getInstalled(9), undefined)
  })
})

/**
 * The room on the drive, which is asked about before any bytes move.
 *
 * The figures belong to whatever machine the suite is running on, so a test
 * that named one would be a test about this disk. Two ways round that: a game
 * no disk could hold, which is refused everywhere, and a game sized against
 * what `spaceOf` reports for the folder a moment earlier, which is how the
 * arithmetic can be pinned without knowing the answer in advance.
 */
describe('the room on the drive', () => {
  /** Bigger than any disk this will ever run on, and safely under 2^53. */
  const IMMENSE = 1e15

  /**
   * What a stopped transfer left behind, and the room it is measured against.
   *
   * The free space is read once and relied on a moment later, on a disk every
   * other test file running beside this one is writing to. Both figures are
   * far larger than anything those writes add up to, so the answer cannot
   * change in between; the held file is sparse, so its size costs no room.
   */
  const HELD = 4 * 1024 * 1024 * 1024
  const MARGIN = 2 * 1024 * 1024 * 1024

  test('a game no disk could hold is refused before the transfer starts', async () => {
    const { downloads, root } = manager()

    await downloads.enqueue(rom({ fs_size_bytes: IMMENSE }))
    const item = await settled(downloads, 1)

    assert.equal(item.state, 'error')
    // Both figures and the folder: a refusal naming only one of them leaves
    // the reader unable to tell a full disk from an enormous game.
    assert.match(item.error ?? '', /Not enough room: .+ needed, .+ free in .+genesis/)
    assert.ok(!existsSync(join(root, 'roms', 'genesis', 'Sonic the Hedgehog (USA).md.part')))
  })

  test('a game the server declares no size for is left to try', async () => {
    // What RomM reports for a game it has no size for. A check that refused
    // those would be the reason they cannot be downloaded at all.
    const { downloads } = manager()

    await downloads.enqueue(rom({ fs_size_bytes: 0 }))

    assert.equal((await settled(downloads, 1)).state, 'done')
  })

  test('what is already on disk counts: a resumed transfer needs the rest', async () => {
    const { downloads, store, root } = manager({ contents: 'rom bytes' })
    const dir = join(root, 'roms', 'genesis')
    mkdirSync(dir, { recursive: true })
    const target = join(dir, 'Sonic the Hedgehog (USA).md')
    writeFileSync(`${target}.part`, '')
    truncateSync(`${target}.part`, HELD)
    const space = await spaceOf(dir)
    assert.ok(space)

    /*
     * Larger than the drive by everything but the margin, and all but that
     * already here: sized against the whole game this is refused, and sized
     * against the remainder it fits with room to spare. The gap between the
     * two is what the rule is.
     */
    const total = space.freeBytes + HELD - MARGIN
    store.setPending({
      romId: 1,
      name: 'Sonic the Hedgehog',
      coverPath: null,
      system: 'genesis',
      platformName: 'Sega Mega Drive',
      targetPath: target,
      files: [],
      ownsFolder: false,
      fileName: 'Sonic the Hedgehog (USA).md',
      totalBytes: total
    })
    await downloads.restorePending()

    await downloads.enqueue(rom({ fs_size_bytes: total }))

    assert.equal((await settled(downloads, 1)).state, 'done')
  })
})

describe('a game of several discs', () => {
  /**
   * A multi-file game as RomM describes one: each file named by its leaf, with
   * the folder it was found in beside it. The shapes are the synthetic
   * library's (test/romm/make-library.mjs), which are the owner's.
   */
  function discSet(
    platform: string,
    folder: string,
    files: { path: string; bytes: number }[],
    id = 7
  ): RommRom {
    return rom({
      id,
      name: folder,
      fs_name: folder,
      fs_name_no_ext: folder,
      fs_extension: '',
      fs_path: `roms/${platform}`,
      has_multiple_files: true,
      // RomM's slug for the system, beside the owner's folder name for it.
      platform_slug: platform === 'ps1' ? 'psx' : platform,
      platform_fs_slug: platform,
      files: files.map(({ path, bytes }, at) => {
        const cut = path.lastIndexOf('/')
        const below = cut === -1 ? '' : `/${path.slice(0, cut)}`
        return {
          id: at + 1,
          rom_id: id,
          file_name: path.slice(cut + 1),
          file_path: `roms/${platform}/${folder}${below}`,
          file_size_bytes: bytes
        }
      }) as RommRom['files']
    })
  }

  test("a PS1 folder of discs is launched by Galleon's own playlist, in disc order", async () => {
    const { downloads, store, root } = manager({ perFile: true })
    const saga = 'Galleon Test Saga (USA)'
    await downloads.enqueue(
      discSet('ps1', saga, [
        { path: `${saga} (Disc 2).chd`, bytes: 20 },
        { path: `${saga} (Disc 10).chd`, bytes: 30 },
        { path: `${saga} (Disc 1).chd`, bytes: 10 }
      ])
    )
    assert.equal((await settled(downloads, 7)).state, 'done')

    const dir = join(root, 'roms', 'psx', saga)
    const installed = store.getInstalled(7)
    assert.equal(installed?.launchPath, join(dir, `${saga}.m3u`))
    assert.equal(
      readFileSync(join(dir, `${saga}.m3u`), 'utf8'),
      `${saga} (Disc 1).chd\n${saga} (Disc 2).chd\n${saga} (Disc 10).chd\n`
    )
    assert.ok(installed?.files.includes(`${saga}.m3u`))
  })

  test('a GameCube folder of two discs gets the same, and a server playlist is never fetched', async () => {
    const { downloads, store, root } = manager({ perFile: true })
    const cube = 'Galleon Test Two Discs (USA)'
    await downloads.enqueue(
      discSet('ngc', cube, [
        { path: `${cube} (Disc 1).iso`, bytes: 10 },
        { path: `${cube} (Disc 2).iso`, bytes: 20 },
        // Written for a layout that is not this one, so it is not followed.
        { path: `${cube}.m3u`, bytes: 99 }
      ])
    )
    assert.equal((await settled(downloads, 7)).state, 'done')

    const dir = join(root, 'roms', 'gc', cube)
    assert.equal(
      readFileSync(join(dir, `${cube}.m3u`), 'utf8'),
      `${cube} (Disc 1).iso\n${cube} (Disc 2).iso\n`
    )
    assert.equal(store.getInstalled(7)?.launchPath, join(dir, `${cube}.m3u`))
  })

  test('generic track names in a folder per disc keep to their own disc', async () => {
    const { downloads, store, root } = manager({ perFile: true })
    const dream = 'Galleon Test Dream Set (USA)'
    const disc = (n: number, size: number): { path: string; bytes: number }[] => [
      { path: `Disc ${n}/disc.gdi`, bytes: 8 },
      { path: `Disc ${n}/track01.bin`, bytes: size },
      { path: `Disc ${n}/track02.raw`, bytes: size + 1 },
      { path: `Disc ${n}/track03.bin`, bytes: size + 2 }
    ]
    await downloads.enqueue(discSet('dc', dream, [...disc(1, 10), ...disc(2, 40)]))
    assert.equal((await settled(downloads, 7)).state, 'done')

    const dir = join(root, 'roms', 'dreamcast', dream)
    // Each disc's tracks are its own bytes, not the other disc's written over them.
    assert.equal(statSync(join(dir, 'Disc 1', 'track01.bin')).size, 10)
    assert.equal(statSync(join(dir, 'Disc 2', 'track01.bin')).size, 40)
    assert.equal(statSync(join(dir, 'Disc 2', 'track03.bin')).size, 42)
    assert.equal(
      readFileSync(join(dir, `${dream}.m3u`), 'utf8'),
      'Disc 1/disc.gdi\nDisc 2/disc.gdi\n'
    )
    const installed = store.getInstalled(7)
    assert.equal(installed?.launchPath, join(dir, `${dream}.m3u`))
    assert.equal(installed?.files.filter((name) => name.endsWith('track01.bin')).length, 2)
  })

  test('the playlist path never has .m3u in a folder name', async () => {
    const { downloads, store, root } = manager({ perFile: true })
    // RomM holds this set in a folder named like a playlist, as some libraries do.
    const named = 'Galleon Test Saga (USA).m3u'
    await downloads.enqueue(
      discSet('ps1', named, [
        { path: 'Galleon Test Saga (USA) (Disc 1).chd', bytes: 10 },
        { path: 'Galleon Test Saga (USA) (Disc 2).chd', bytes: 20 }
      ])
    )
    assert.equal((await settled(downloads, 7)).state, 'done')

    const playlist = store.getInstalled(7)?.launchPath ?? ''
    assert.ok(playlist.endsWith('.m3u'), playlist)
    const folders = relative(root, playlist).split(sep).slice(0, -1)
    assert.deepEqual(
      folders.filter((folder) => folder.toLowerCase().includes('.m3u')),
      []
    )
    assert.ok(existsSync(playlist))
  })

  test('a game of one disc writes none and launches its descriptor', async () => {
    const { downloads, store, root } = manager({ perFile: true })
    const single = 'Galleon Test Single Track (USA)'
    await downloads.enqueue(
      discSet('ps1', single, [
        { path: `${single}.cue`, bytes: 8 },
        { path: `${single} (Track 1).bin`, bytes: 64 },
        { path: `${single} (Track 2).bin`, bytes: 32 }
      ])
    )
    assert.equal((await settled(downloads, 7)).state, 'done')
    const dir = join(root, 'roms', 'psx', single)
    assert.equal(store.getInstalled(7)?.launchPath, join(dir, `${single}.cue`))
    assert.equal(existsSync(join(dir, `${single}.m3u`)), false)
  })
})
