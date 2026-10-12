/**
 * The save round trips (M2-03): every golden fixture in
 * `test/fixtures/saves/` goes up from an Argosy device the way
 * docs/save-sync/SPEC.md says Argosy sends it, and the fork's RomM client
 * meets it as a second device; then the same in reverse.
 *
 *   npm run test:saves
 *   ROMM_PROFILE=v520 npm run test:saves-real
 *
 * Argosy here is a stand-in written from the spec, not Argosy's code. RomM
 * decides through `POST /api/sync/negotiate` (SPEC.md section 5), so each
 * scenario asks it, from each device, what it would have that device do.
 *
 * Only ever against the disposable servers in test/romm/compose.yml: each
 * scenario empties the slot of its game first, so a rerun against a server
 * that already ran it starts where a fresh one does.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { RommError } from '../../src/main/romm/errors.ts'
import type { RommRom, RommSave } from '../../src/shared/types/romm.ts'
import { assertFitsSchema, client, romNamed, scratch, state, watch } from '../romm/server.ts'
import { contentHash, filler, FIXTURES, MANIFEST, zip } from './fixtures.mjs'
import type { FixtureEntry } from './fixtures.mjs'

const fixtures = (
  JSON.parse(readFileSync(join(FIXTURES, MANIFEST), 'utf8')) as { fixtures: FixtureEntry[] }
).fixtures

/** A device name no earlier run used. */
const fresh = (who: string): string => `galleon-test-saves-${who}-${randomBytes(6).toString('hex')}`

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${state.baseUrl}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${state.clientToken}`, ...init.headers }
  })
}

async function ok(res: Response, what: string): Promise<Response> {
  if (!res.ok) assert.fail(`${what}: ${res.status} ${await res.text()}`)
  return res
}

/** One line of a negotiate inventory (SPEC.md section 5). */
interface Held {
  rom_id: number
  file_name: string
  slot: string
  emulator: string
  content_hash: string
  updated_at: string
  file_size_bytes: number
}

interface Operation {
  action: 'upload' | 'download' | 'conflict' | 'no_op'
  rom_id: number
  save_id: number | null
  slot: string | null
  reason: string
}

/** Ask RomM what `deviceId` should do, keeping only what concerns `rom`. */
async function negotiate(deviceId: string, held: Held[], rom: RommRom): Promise<Operation[]> {
  const res = await ok(
    await api('/api/sync/negotiate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: deviceId, saves: held })
    }),
    'negotiate'
  )
  // RomM 5.2.0 answers for the whole library (SPEC.md section 5), and other
  // scenarios' saves are in it; a pre-launch check drops the rest the same way.
  const { operations } = (await res.json()) as { operations: Operation[] }
  return operations.filter((operation) => operation.rom_id === rom.id)
}

/** The device save sync would see as Argosy (SPEC.md sections 3 and 6). */
class Argosy {
  private constructor(readonly deviceId: string) {}

  static async register(): Promise<Argosy> {
    const res = await ok(
      await api('/api/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: fresh('argosy'),
          platform: 'android',
          client: 'argosy-launcher',
          sync_mode: 'api'
        })
      }),
      'register an Argosy device'
    )
    return new Argosy(((await res.json()) as { device_id: string }).device_id)
  }

  /**
   * Argosy's upload of the autosave slot, autocleanup and all: this is the
   * other device, and section 8 is about what Galleon sends, not what it meets.
   */
  async upload(rom: RommRom, entry: FixtureEntry, bytes: Buffer): Promise<Response> {
    const params = new URLSearchParams({
      rom_id: String(rom.id),
      emulator: entry.emulator,
      device_id: this.deviceId,
      overwrite: 'false',
      slot: entry.slot,
      autocleanup: 'true',
      autocleanup_limit: '10'
    })
    const form = new FormData()
    form.append(
      'saveFile',
      new Blob([bytes], { type: 'application/octet-stream' }),
      entry.uploadName
    )
    return api(`/api/saves?${params.toString()}`, { method: 'POST', body: form })
  }

  /** A download as section 6 has it: no record until the bytes are confirmed. */
  async download(id: number): Promise<Buffer> {
    const query = `device_id=${this.deviceId}`
    await ok(await api(`/api/saves/${id}?${query}`), 'read the save')
    const res = await ok(
      await api(`/api/saves/${id}/content?${query}&optimistic=false`),
      'download the save'
    )
    const bytes = Buffer.from(await res.arrayBuffer())
    await ok(
      await api(`/api/saves/${id}/downloaded`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_id: this.deviceId })
      }),
      'confirm the download'
    )
    return bytes
  }
}

/** What a device holding `save`'s bytes, unchanged since the transfer, reports. */
function holding(save: RommSave, entry: FixtureEntry): Held {
  assert.ok(save.content_hash, `${entry.path}: the server stored no content_hash`)
  return {
    rom_id: save.rom_id,
    file_name: entry.uploadName,
    slot: entry.slot,
    emulator: entry.emulator,
    content_hash: save.content_hash,
    updated_at: save.updated_at,
    file_size_bytes: save.file_size_bytes
  }
}

/** The same save after another session: the same shape, other bytes. */
function played(entry: FixtureEntry, bytes: Buffer): { bytes: Buffer; hash: string } {
  if (entry.shape === 'raw') {
    const changed = Buffer.from(bytes)
    const at = Math.floor(changed.length / 2)
    changed[at] = changed[at]! ^ 0xff
    return { bytes: changed, hash: contentHash(null, changed) }
  }
  const entries = entry.entries!.map((e) => ({
    name: e.name,
    data: filler(`played:${entry.path}:${e.name}`, e.bytes)
  }))
  const changed = zip(entries)
  return { bytes: changed, hash: contentHash(entries, changed) }
}

const romFor = (entry: FixtureEntry): Promise<RommRom> => romNamed(entry.rom.split('/').at(-1)!)

/** A disposable server only: see the header. */
async function emptySlot(rom: RommRom): Promise<void> {
  const saves = await client().saves(rom.id)
  await client().deleteSaves(saves.filter((s) => s.slot !== null).map((s) => s.id))
}

/** RomM's name for a slotted upload: the name sent, stamped with the time. */
function assertStampedName(save: RommSave, entry: FixtureEntry): void {
  const dot = entry.uploadName.lastIndexOf('.')
  const stem = entry.uploadName.slice(0, dot)
  const ext = entry.uploadName.slice(dot)
  assert.ok(
    save.file_name.startsWith(`${stem} [`) && save.file_name.endsWith(`]${ext}`),
    `${entry.path}: stored as ${save.file_name}`
  )
  assert.match(save.file_name.slice(stem.length + 1), /^\[\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d\]/)
}

async function rejection(upload: Promise<unknown>): Promise<RommError> {
  try {
    await upload
  } catch (error) {
    if (error instanceof RommError) return error
    throw error
  }
  return assert.fail('the upload went through')
}

/** The save as RomM keeps it, which is what a device later reports back. */
async function stored(id: number): Promise<RommSave> {
  return (await (await ok(await api(`/api/saves/${id}`), 'read the save')).json()) as RommSave
}

/**
 * Wait for the clock to pass into the next second. RomM keeps times to the
 * second and compares them strictly (SPEC.md section 5), so a save made in the
 * same second as another device's sync record is not newer than it; between
 * two people's sessions, time has always passed.
 */
async function nextSecond(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 1000 - (Date.now() % 1000) + 50))
}

for (const entry of fixtures) {
  const bytes = readFileSync(join(FIXTURES, entry.path))

  test(`${entry.path}: Argosy's save is stored as sent, and identical bytes on both devices negotiate to no_op twice`, async (t) => {
    const rom = await romFor(entry)
    await emptySlot(rom)
    const sent = watch()

    const argosy = await Argosy.register()
    const save = (await (
      await ok(await argosy.upload(rom, entry, bytes), 'Argosy upload')
    ).json()) as RommSave
    assert.equal(save.rom_id, rom.id)
    assert.equal(save.slot, entry.slot)
    assert.equal(save.emulator, entry.emulator)
    assert.equal(save.file_size_bytes, entry.bytes)
    assert.equal(save.content_hash, entry.contentHash, `${entry.path}: RomM's hash`)
    assertStampedName(save, entry)

    for (const round of [1, 2]) {
      const ops = await negotiate(argosy.deviceId, [holding(save, entry)], rom)
      assert.deepEqual(
        ops.map((op) => op.action),
        ['no_op'],
        `Argosy, round ${round}: ${JSON.stringify(ops)}`
      )
    }

    // The fork, a device RomM has never seen, holding the same bytes it got
    // some other way: only the hash can say they are the same save.
    const fork = client(fresh('fork'))
    const forkId = (await fork.deviceId())!
    const local = { ...holding(save, entry), updated_at: new Date().toISOString() }
    for (const round of [1, 2]) {
      const ops = await negotiate(forkId, [local], rom)
      assert.deepEqual(
        ops.map((op) => op.action),
        ['no_op'],
        `fork, round ${round}: ${JSON.stringify(ops)}`
      )
    }

    const back = join(scratch(t), 'down')
    await fork.downloadSave(save.id, back)
    assert.deepEqual(readFileSync(back), bytes, `${entry.path}: not byte for byte`)
    assertFitsSchema(sent)
  })

  test(`${entry.path}: the fork's upload over Argosy's is refused until the player keeps it, and Argosy then downloads it`, async (t) => {
    const rom = await romFor(entry)
    await emptySlot(rom)
    const sent = watch()

    const argosy = await Argosy.register()
    const uploaded = (await (
      await ok(await argosy.upload(rom, entry, bytes), 'Argosy upload')
    ).json()) as RommSave
    const theirs = await stored(uploaded.id)

    const dir = scratch(t)
    const ours = played(entry, bytes)
    const file = join(dir, entry.uploadName)
    writeFileSync(file, ours.bytes)
    const fork = client(fresh('fork'))

    const refused = await rejection(
      fork.uploadSave(rom.id, file, entry.uploadName, entry.emulator, entry.slot)
    )
    assert.equal(refused.status, 409, `${entry.path}: ${refused.message}`)
    const after = await client().saves(rom.id)
    assert.deepEqual(
      after.filter((s) => s.slot === entry.slot).map((s) => s.id),
      [theirs.id],
      'the refused upload left a save behind'
    )

    // "Keep this device's save": the one place the fork overwrites.
    await nextSecond()
    const kept = await fork.uploadSave(rom.id, file, entry.uploadName, entry.emulator, entry.slot, {
      keepThisDevice: true
    })
    assert.equal(kept.content_hash, ours.hash, `${entry.path}: RomM's hash of the kept save`)
    assert.ok(
      (await client().saves(rom.id)).some((s) => s.id === theirs.id),
      "keeping this device's save deleted Argosy's"
    )

    const ops = await negotiate(argosy.deviceId, [holding(theirs, entry)], rom)
    assert.deepEqual(
      ops.map((op) => [op.action, op.save_id]),
      [['download', kept.id]],
      JSON.stringify(ops)
    )
    assert.deepEqual(await argosy.download(kept.id), ours.bytes)
    assertFitsSchema(sent)
  })

  test(`${entry.path}: the fork's save reaches a new Argosy device, which then negotiates to no_op twice`, async (t) => {
    const rom = await romFor(entry)
    await emptySlot(rom)
    const sent = watch()

    const dir = scratch(t)
    const file = join(dir, entry.uploadName)
    writeFileSync(file, bytes)
    const fork = client(fresh('fork'))
    const ours = await fork.uploadSave(rom.id, file, entry.uploadName, entry.emulator, entry.slot)
    assert.equal(ours.content_hash, entry.contentHash, `${entry.path}: RomM's hash`)
    assertStampedName(ours, entry)

    const argosy = await Argosy.register()
    const first = await negotiate(argosy.deviceId, [], rom)
    assert.deepEqual(
      first.map((op) => [op.action, op.save_id]),
      [['download', ours.id]],
      JSON.stringify(first)
    )
    assert.deepEqual(await argosy.download(ours.id), bytes, `${entry.path}: not byte for byte`)

    for (const round of [1, 2]) {
      const ops = await negotiate(argosy.deviceId, [holding(ours, entry)], rom)
      assert.deepEqual(
        ops.map((op) => op.action),
        ['no_op'],
        `Argosy, round ${round}: ${JSON.stringify(ops)}`
      )
    }
    assertFitsSchema(sent)
  })
}
