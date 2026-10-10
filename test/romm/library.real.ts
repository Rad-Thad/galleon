/**
 * The synthetic library, as a provisioned Docker RomM sees it: the platforms
 * and the multi-disc, cue/bin and nested-folder rows carry the same flags the
 * owner's server gives the same shapes (docs/DEVICE-FACTS.md).
 *
 *   node test/romm/make-library.mjs
 *   docker compose -f test/romm/compose.yml --profile v520 up -d
 *   node test/romm/provision.mjs --profile v520
 *   ROMM_PROFILE=v520 npm run test:romm-real
 *
 * Needs a server provisioned on a fresh database: a quick scan does not
 * rewrite rows an earlier library left behind.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { statePath, type State } from './lib.mjs'
import { BIOS, BIOS_STUB_BYTES, ROMS } from './make-library.mjs'
import { pathInGame, playlistFor } from '../../src/shared/gamefiles.ts'

const profile = process.env.ROMM_PROFILE ?? 'v520'

interface Rom {
  fs_name: string
  fs_path: string
  platform_fs_slug: string
  has_multiple_files: boolean
  has_nested_single_file: boolean
  files: { file_name: string; file_path: string; is_top_level: boolean }[]
}

function readState(): State {
  try {
    return JSON.parse(readFileSync(statePath(profile), 'utf8')) as State
  } catch {
    throw new Error(
      `no provisioned ${profile}: run node test/romm/provision.mjs --profile ${profile}`
    )
  }
}

async function get<T>(path: string): Promise<T> {
  const { baseUrl, clientToken } = readState()
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${clientToken}` }
  })
  assert.equal(res.status, 200, `${path}: ${await res.clone().text()}`)
  return (await res.json()) as T
}

const roms = async (): Promise<Map<string, Rom>> => {
  const { items } = await get<{ items: Rom[] }>('/api/roms?limit=500&with_files=true')
  return new Map(items.map((rom) => [`${rom.platform_fs_slug}/${rom.fs_name}`, rom]))
}

test(`every fixture platform is scanned on RomM ${profile}`, async () => {
  const platforms = await get<{ fs_slug: string }[]>('/api/platforms')
  const want = [...new Set(ROMS.map((path) => path.split('/')[1]))].sort()
  assert.deepEqual(platforms.map((p) => p.fs_slug).sort(), want)
})

test('one row per top-level entry, so a cue/bin pair is two ROMs', async () => {
  const want = new Set(ROMS.map((path) => path.split('/').slice(1, 3).join('/')))
  const got = await roms()
  assert.deepEqual([...got.keys()].sort(), [...want].sort())
  for (const name of ['ps2/Galleon Test Track (USA).cue', 'ps2/Galleon Test Track (USA).bin']) {
    const rom = got.get(name)
    assert.ok(rom, name)
    assert.equal(rom.has_multiple_files, false)
    assert.equal(rom.has_nested_single_file, false)
  }
})

test('a multi-disc folder has multiple files, one per disc', async () => {
  const got = await roms()
  for (const name of ['ps1/Galleon Test Saga (USA)', 'ngc/Galleon Test Two Discs (USA)']) {
    const rom = got.get(name)
    assert.ok(rom, name)
    assert.equal(rom.has_multiple_files, true)
    assert.equal(rom.has_nested_single_file, false)
    assert.equal(rom.files.filter((f) => f.is_top_level).length, 2)
  }
})

test("a multi-disc folder's files sit where pathInGame says, and get a playlist", async () => {
  const got = await roms()
  for (const [name, system] of [
    ['ps1/Galleon Test Saga (USA)', 'psx'],
    ['ngc/Galleon Test Two Discs (USA)', 'gc']
  ]) {
    const rom = got.get(name)
    assert.ok(rom, name)
    const want = ROMS.filter((path) => path.startsWith(`roms/${name}/`))
      .map((path) => path.slice(`roms/${name}/`.length))
      .sort()
    const paths = rom.files.map((file) => pathInGame(rom, file)).sort()
    assert.deepEqual(paths, want)
    assert.ok(playlistFor(paths, system), name)
  }
  // Below the game's own folder the layout is kept, which is what stops two
  // discs' same-named tracks landing on one another.
  const portable = got.get('psp/Galleon Test Portable (USA)')
  assert.ok(portable)
  assert.ok(
    portable.files.map((file) => pathInGame(portable, file)).includes('PSP/GAME/GTST00001/DLC.EDAT')
  )
})

test('a PSP folder with extras below its image is a nested single file', async () => {
  const rom = (await roms()).get('psp/Galleon Test Portable (USA)')
  assert.ok(rom)
  assert.equal(rom.has_nested_single_file, true)
  assert.equal(rom.has_multiple_files, false)
  assert.deepEqual(
    rom.files.filter((f) => f.is_top_level).map((f) => f.file_name),
    ['Galleon Test Portable (USA).iso']
  )
  assert.ok(rom.files.some((f) => f.file_name === 'DLC.EDAT' && !f.is_top_level))
})

test('the entry without an extension is a plain single file', async () => {
  const rom = (await roms()).get('psp/Galleon Test No Extension')
  assert.ok(rom)
  assert.equal(rom.has_multiple_files, false)
  assert.equal(rom.has_nested_single_file, false)
})

test('firmware stubs are listed under their names, all of the stub size', async () => {
  const firmware = await get<{ file_name: string; file_size_bytes: number }[]>('/api/firmware')
  assert.deepEqual(
    firmware.map((f) => f.file_name).sort(),
    BIOS.map((path) => path.split('/').at(-1)).sort()
  )
  for (const f of firmware) assert.equal(f.file_size_bytes, BIOS_STUB_BYTES, f.file_name)
})
