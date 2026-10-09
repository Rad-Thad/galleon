/**
 * RomMix's own client against a provisioned Docker RomM: the calls Galleon
 * depends on, made the way the app makes them, against the server versions
 * the owner's has run.
 *
 *   npm run test:romm                 # every *.real.ts on 5.2.0, then 5.3.1
 *   ROMM_PROFILE=v520 npm run test:romm-real
 *
 * Read-only against the library: nothing here uploads, registers or reports,
 * so it can run on a server another suite has already used.
 */
import { afterEach, test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RommClient } from '../../src/main/romm/client.ts'
import type { Store } from '../../src/main/store.ts'
import type { RommRom } from '../../src/shared/types/romm.ts'
import { statePath, type State } from './lib.mjs'
import { ROMS } from './make-library.mjs'

const profile = process.env.ROMM_PROFILE ?? 'v520'

function readState(): State {
  try {
    return JSON.parse(readFileSync(statePath(profile), 'utf8')) as State
  } catch {
    throw new Error(
      `no provisioned ${profile}: run node test/romm/provision.mjs --profile ${profile}`
    )
  }
}

const state = readState()

/** The slice of `Store` the client reads, signed in with the provisioned token. */
function client(): RommClient {
  const credentials = { accessToken: null, refreshToken: null, clientToken: state.clientToken }
  const store = {
    server: { baseUrl: state.baseUrl },
    settings: { deviceId: state.deviceId, deviceName: 'Galleon test:romm' },
    credentials,
    setCredentials: (patch: object) => Object.assign(credentials, patch),
    clearCredentials: () => undefined
  } as unknown as Store
  return new RommClient(store)
}

/** Every request the client sends, with the one header these tests are about. */
interface Sent {
  url: string
  method: string
  range: string | null
}

const realFetch = globalThis.fetch

/**
 * Record what goes out, and let a test break the body of one reply.
 *
 * Broken in the middle of the body, after the server has answered, which is
 * the interruption a transfer meets in practice: a proxy cutting the response
 * or a link dropping mid-copy.
 */
function watch(breakAt?: { path: string; fraction: number }): Sent[] {
  const sent: Sent[] = []
  let broken = false
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    const headers = new Headers(init?.headers)
    sent.push({ url, method: init?.method ?? 'GET', range: headers.get('range') })
    const res = await realFetch(input, init)
    if (!breakAt || broken || !url.includes(breakAt.path) || headers.has('range')) return res
    broken = true
    const bytes = new Uint8Array(await res.arrayBuffer())
    const cut = Math.floor(bytes.length * breakAt.fraction)
    // Ended cleanly at the cut, still declaring the whole length: what a
    // proxy closing the response looks like, and unlike a stream that errors,
    // it cannot lose the half on its way to the disk.
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.subarray(0, cut))
        controller.close()
      }
    })
    return new Response(body, { status: res.status, headers: res.headers })
  }) as typeof fetch
  return sent
}

afterEach(() => {
  globalThis.fetch = realFetch
})

const md5 = (path: string): string => createHash('md5').update(readFileSync(path)).digest('hex')

function scratch(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'galleon-test-romm-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

async function romNamed(fsName: string): Promise<RommRom> {
  const page = await client().roms({ search_term: fsName.replace(/\.[^.]+$/, ''), limit: 50 })
  const rom = page.items.find((item) => item.fs_name === fsName)
  assert.ok(rom, `${fsName} is not in the library`)
  return rom
}

test(`the heartbeat names RomM ${state.version}`, async () => {
  assert.deepEqual(await client().heartbeat(), { version: state.version })
})

test('platforms come back under the library folder names', async () => {
  const slugs = (await client().platforms()).map((p) => p.fs_slug).sort()
  assert.deepEqual(slugs, [...new Set(ROMS.map((path) => path.split('/')[1]))].sort())
})

test('the listing pages by limit and offset, and every page carries files', async () => {
  const all = await client().roms({ limit: 500 })
  assert.ok(all.items.length >= 4, `only ${all.items.length} ROMs`)
  assert.equal(all.total, all.items.length)

  const seen: number[] = []
  for (let offset = 0; offset < all.items.length; offset += 3) {
    const page = await client().roms({ limit: 3, offset })
    assert.equal(page.total, all.total)
    assert.ok(page.items.length <= 3)
    for (const rom of page.items) assert.ok(rom.files.length > 0, `${rom.fs_name} has no files`)
    seen.push(...page.items.map((rom) => rom.id))
  }
  assert.deepEqual(
    seen,
    all.items.map((rom) => rom.id)
  )
})

test('the listing without files is the same ROMs with no file list', async () => {
  const res = await realFetch(`${state.baseUrl}/api/roms?limit=500&with_files=false`, {
    headers: { Authorization: `Bearer ${state.clientToken}` }
  })
  assert.equal(res.status, 200)
  const bare = (await res.json()) as { items: { id: number; files?: unknown[] }[] }
  const full = await client().roms({ limit: 500 })
  assert.deepEqual(bare.items.map((rom) => rom.id).sort(), full.items.map((rom) => rom.id).sort())
  for (const rom of bare.items) assert.ok(!rom.files?.length, `${rom.id} listed files anyway`)
})

test('a single-file download broken at 50% resumes by range and matches its md5', async (t) => {
  const rom = await romNamed('Galleon Test Cartridge (USA).sfc')
  const [file] = rom.files
  assert.ok(file.md5_hash, 'the scan recorded no md5')
  assert.equal(await client().supportsRange(rom), true)

  const destination = join(scratch(t), rom.fs_name)
  const sent = watch({ path: `/api/roms/${rom.id}/content/`, fraction: 0.5 })
  await client().downloadRom(rom, destination, () => undefined, new AbortController().signal)

  const transfers = sent.filter((s) => s.url.includes(`/api/roms/${rom.id}/content/`))
  const half = Math.floor(file.file_size_bytes * 0.5)
  assert.deepEqual(
    transfers.map((s) => s.range),
    [null, `bytes=${half}-`]
  )
  assert.equal(md5(destination), file.md5_hash)
})

test('one file of a multi-file game downloads by its own id and resumes', async (t) => {
  const rom = await romNamed('Galleon Test Saga (USA)')
  assert.equal(rom.has_multiple_files, true)
  assert.deepEqual(await client().fileTransfers(rom), { available: true, resumable: true })

  const file = rom.files[1]
  const destination = join(scratch(t), file.file_name)
  const sent = watch({ path: `/api/roms/${file.id}/files/content/`, fraction: 0.5 })
  await client().downloadRomFile(file, destination, () => undefined, new AbortController().signal)

  const half = Math.floor(file.file_size_bytes * 0.5)
  assert.deepEqual(
    sent.map((s) => s.range),
    [null, `bytes=${half}-`]
  )
  assert.equal(md5(destination), file.md5_hash)
})

/**
 * Phase 0 saw 405 for HEAD on this endpoint, so GET is the method the client
 * uses; the test name carries the HEAD answer this server gave.
 */
const fileHead = await (async () => {
  const rom = await (async () => {
    const res = await realFetch(`${state.baseUrl}/api/roms?limit=500&with_files=true`, {
      headers: { Authorization: `Bearer ${state.clientToken}` }
    })
    const { items } = (await res.json()) as { items: RommRom[] }
    return items.find((item) => item.has_multiple_files)
  })()
  if (!rom) return { rom: undefined, status: 0 }
  const file = rom.files[0]
  const res = await realFetch(
    `${state.baseUrl}/api/roms/${file.id}/files/content/${encodeURIComponent(file.file_name)}`,
    { method: 'HEAD', headers: { Authorization: `Bearer ${state.clientToken}` } }
  )
  return { rom, status: res.status }
})()

test(`GET /api/roms/{id}/files/content/{name} serves the file on RomM ${state.version} (HEAD answers ${fileHead.status})`, async () => {
  assert.ok(fileHead.rom, 'no multi-file ROM in the library')
  const file = fileHead.rom.files[0]
  const res = await realFetch(
    `${state.baseUrl}/api/roms/${file.id}/files/content/${encodeURIComponent(file.file_name)}`,
    { headers: { Authorization: `Bearer ${state.clientToken}` } }
  )
  assert.equal(res.status, 200)
  const bytes = Buffer.from(await res.arrayBuffer())
  assert.equal(bytes.length, file.file_size_bytes)
  assert.equal(createHash('md5').update(bytes).digest('hex'), file.md5_hash)
})
