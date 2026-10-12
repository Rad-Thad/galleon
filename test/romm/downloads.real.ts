/**
 * The download queue against a provisioned Docker RomM: a game of several
 * files, fetched one file at a time, stopped part-way and finished later.
 *
 *   npm run test:romm
 *
 * The queue, the library and the store are the app's own, over a scratch
 * `GALLEON_HOME`; only the wire is watched, so what is asserted is what RomM
 * was asked for. Read-only against the server.
 */
import { afterEach, test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { DownloadManager } from '../../src/main/downloads.ts'
import { Library } from '../../src/main/library.ts'
import { log } from '../../src/main/log.ts'
import { OfflineCache } from '../../src/main/offline.ts'
import { RommClient } from '../../src/main/romm/client.ts'
import { partialPathOf } from '../../src/main/romm/transfer.ts'
import { rootPaths } from '../../src/main/root.ts'
import { Store } from '../../src/main/store.ts'
import { pathInGame } from '../../src/shared/gamefiles.ts'
import type { DownloadItem, RommRom } from '../../src/shared/types/index.ts'
import { md5, realFetch, romNamed, scratch, state, type Sent } from './server.ts'

const SAGA = 'Galleon Test Saga (USA)'

const realHome = process.env.GALLEON_HOME
const queues: DownloadManager[] = []

afterEach(async () => {
  for (const downloads of queues.splice(0)) await downloads.whenIdle()
  log.close()
  if (realHome === undefined) delete process.env.GALLEON_HOME
  else process.env.GALLEON_HOME = realHome
})

/** The app's queue over a scratch root, signed in to the Docker RomM. */
function queue(t: TestContext): { downloads: DownloadManager; root: string } {
  const root = scratch(t)
  process.env.GALLEON_HOME = root
  const store = new Store(join(root, 'config'))
  // The fixture's `ps1` folder is not one RomM identifies with no metadata
  // source, so it is named the way a user names an unmapped platform.
  store.updateSettings({ romStorage: 'rommix', systemOverrides: { ps1: 'psx' } })
  store.setServer({ baseUrl: state.baseUrl, authMode: 'token' })
  store.setCredentials({ clientToken: state.clientToken })
  const client = new RommClient(store)
  const library = new Library(
    store,
    client,
    new OfflineCache(rootPaths().offline, client),
    () => null
  )
  const downloads = new DownloadManager(store, client, library)
  queues.push(downloads)
  return { downloads, root }
}

/** Until this ROM's row passes the check, by the queue's own events. */
function reached(
  downloads: DownloadManager,
  romId: number,
  check: (item: DownloadItem) => boolean,
  what: string
): Promise<DownloadItem> {
  const find = (items: DownloadItem[]): DownloadItem | undefined =>
    items.find((item) => item.romId === romId)
  const now = find(downloads.items)
  if (now && check(now)) return Promise.resolve(now)
  return new Promise((resolve, reject) => {
    const listen = (items: DownloadItem[]): void => {
      const item = find(items)
      if (!item || !check(item)) return
      clearTimeout(deadline)
      downloads.off('update', listen)
      resolve(item)
    }
    const deadline = setTimeout(() => {
      downloads.off('update', listen)
      reject(new Error(`${romId} never reached ${what}: ${JSON.stringify(find(downloads.items))}`))
    }, 30_000)
    downloads.on('update', listen)
  })
}

/** The content requests for each of the game's files, by file name. */
function fetchesOf(rom: RommRom, sent: readonly Sent[]): Map<string, (string | null)[]> {
  const byFile = new Map<string, (string | null)[]>()
  for (const file of rom.files) {
    const path = `/api/roms/${file.id}/files/content/`
    byFile.set(
      file.file_name,
      sent
        // `fileTransfers` asks for one byte to learn whether ranges work.
        .filter((s) => s.url.includes(path) && s.range !== 'bytes=0-0')
        .map((s) => s.range)
    )
  }
  return byFile
}

/**
 * Record every request, and let a test answer one file's first fetch itself.
 *
 * `answer` is handed RomM's real reply and returns what the client sees.
 */
function wire(
  path: string,
  answer: (reply: Response, signal: AbortSignal | undefined) => Promise<Response>
): Sent[] {
  const sent: Sent[] = []
  let answered = false
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    const headers = new Headers(init?.headers)
    sent.push({ url, method: init?.method ?? 'GET', range: headers.get('range'), body: null })
    const res = await realFetch(input, init)
    if (answered || !url.includes(path) || headers.has('range')) return res
    answered = true
    return answer(res, init?.signal ?? undefined)
  }) as typeof fetch
  return sent
}

function installedFiles(root: string): string[] {
  const dir = join(root, 'roms', 'psx', SAGA)
  return readdirSync(dir).sort()
}

test('a multi-file game paused mid-file resumes that file by range and refetches none it finished', async (t) => {
  const rom = await romNamed(SAGA)
  assert.equal(rom.has_multiple_files, true)
  assert.ok(rom.files.length >= 2, `${SAGA} has ${rom.files.length} files`)
  const { downloads, root } = queue(t)

  const broken = rom.files.find((file) => file.file_name.includes('(Disc 2)'))
  assert.ok(broken, 'no disc 2')
  const half = Math.floor(broken.file_size_bytes / 2)
  const partial = partialPathOf(join(root, 'roms', 'psx', SAGA, pathInGame(rom, broken)))

  // Half of disc 2, and then a connection that stays open and says nothing,
  // until the pause below takes it down.
  const sent = wire(`/api/roms/${broken.id}/files/content/`, async (reply) => {
    const bytes = new Uint8Array(await reply.arrayBuffer())
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.subarray(0, half))
      }
    })
    return new Response(body, { status: reply.status, headers: reply.headers })
  })

  await downloads.enqueue(rom)
  await reached(downloads, rom.id, (item) => item.currentFile === broken.file_name, 'disc 2')
  // Paused once the half is on the disk rather than merely counted, so the
  // range it resumes from is the one asserted.
  for (let waited = 0; (statSync(partial, { throwIfNoEntry: false })?.size ?? 0) < half; waited++) {
    assert.ok(waited < 300, 'half of disc 2 never reached the disk')
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  const before = fetchesOf(rom, sent)
  const finished = [...before].filter(
    ([name, ranges]) => name !== broken.file_name && ranges.length
  )
  assert.ok(finished.length > 0, 'disc 2 was the first file fetched, so nothing was finished yet')

  downloads.pause(rom.id)
  const paused = await reached(downloads, rom.id, (item) => item.state === 'paused', 'paused')
  assert.equal(paused.error, null)
  assert.equal(statSync(partial).size, half)

  await downloads.enqueue(rom)
  const done = await reached(
    downloads,
    rom.id,
    (item) => item.state === 'done' || item.state === 'error',
    'done'
  )
  assert.equal(done.state, 'done', done.error ?? '')

  const fetched = fetchesOf(rom, sent)
  for (const file of rom.files) {
    const ranges = fetched.get(file.file_name)
    if (file === broken) assert.deepEqual(ranges, [null, `bytes=${half}-`], file.file_name)
    else assert.deepEqual(ranges, [null], `${file.file_name} was fetched more than once`)
  }
  const dir = join(root, 'roms', 'psx', SAGA)
  for (const file of rom.files) {
    assert.equal(md5(join(dir, pathInGame(rom, file))), file.md5_hash, file.file_name)
  }
  assert.ok(installedFiles(root).some((name) => name.endsWith('.m3u')))
})

test('a file whose bytes do not match its hash is fetched again alone, and said once', async (t) => {
  const rom = await romNamed(SAGA)
  const { downloads, root } = queue(t)
  const refused = rom.files.find((file) => file.file_name.includes('(Disc 2)'))
  assert.ok(refused?.md5_hash, 'disc 2 has no md5')

  const warned: unknown[] = []
  const warn = log.warn.bind(log)
  t.mock.method(log, 'warn', (area: string, message: string, data?: Record<string, unknown>) => {
    if (message === 'a file was refused for its hash, fetching it again') warned.push(data)
    warn(area, message, data)
  })

  // The first copy of disc 2 arrives whole and wrong: its last byte flipped.
  const sent = wire(`/api/roms/${refused.id}/files/content/`, async (reply) => {
    const bytes = new Uint8Array(await reply.arrayBuffer())
    bytes[bytes.length - 1] ^= 0xff
    return new Response(bytes, { status: reply.status, headers: reply.headers })
  })

  await downloads.enqueue(rom)
  const done = await reached(
    downloads,
    rom.id,
    (item) => item.state === 'done' || item.state === 'paused' || item.state === 'error',
    'settled'
  )
  assert.equal(done.state, 'done', done.error ?? '')

  const fetched = fetchesOf(rom, sent)
  for (const file of rom.files) {
    const ranges = fetched.get(file.file_name)
    if (file === refused) assert.deepEqual(ranges, [null, null], 'refetched from its first byte')
    else assert.deepEqual(ranges, [null], `${file.file_name} was fetched more than once`)
  }
  assert.deepEqual(warned, [{ romId: rom.id, fileName: refused.file_name }])
  const dir = join(root, 'roms', 'psx', SAGA)
  for (const file of rom.files) {
    assert.equal(md5(join(dir, pathInGame(rom, file))), file.md5_hash, file.file_name)
  }
})
