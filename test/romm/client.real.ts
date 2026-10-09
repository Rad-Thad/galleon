/**
 * RomMix's own client against a provisioned Docker RomM: the calls Galleon
 * depends on, made the way the app makes them, against the server versions
 * the owner's has run.
 *
 *   npm run test:romm                 # every *.real.ts on 5.2.0, then 5.3.1
 *   ROMM_PROFILE=v520 npm run test:romm-real
 *
 * Read-only against the library: nothing here uploads, registers or reports,
 * so it can run on a server another suite has already used. `sync.real.ts`
 * holds the calls that write.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { RommRom } from '../../src/shared/types/romm.ts'
import { ROMS } from './make-library.mjs'
import {
  assertFitsSchema,
  client,
  md5,
  realFetch,
  romNamed,
  scratch,
  state,
  watch
} from './server.ts'

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
  assertFitsSchema(sent)
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
  assertFitsSchema(sent)
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
