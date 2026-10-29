/**
 * The save calls the engine makes, as one contract that two servers answer
 * (M2-20): Docker RomM 5.2.0 (`contract.real.ts`, in `npm run test:saves`) and
 * the fake the device bundle runs (`contract-fake.test.ts`, in `npm test`).
 *
 * The fake is what the save engine meets on the Nova while the owner's server
 * may only be read, so a device check is only as good as the fake is faithful.
 * Holding both to the same assertions is what keeps it so: a behaviour of
 * RomM's the fake lacks fails here against the fake, and one the fake invents
 * fails here against RomM.
 *
 * Every scenario uses devices and a slot of its own and empties that slot
 * after, so it runs beside the other suites on a shared Docker server.
 */
import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { RommClient } from '../../src/main/romm/client.ts'
import { RommError } from '../../src/main/romm/errors.ts'
import type { Store } from '../../src/main/store.ts'
import type { RommSave } from '../../src/shared/types/romm.ts'
import { contentHash, zip } from './fixtures.mjs'

/** A server the contract runs against, and a game on it to save for. */
export interface ContractTarget {
  baseUrl: string
  token: string
  romId: number
}

// The version a registration reports; out here `electron` is the stub in
// scripts/test-resolve.mjs, which refuses it.
app.getVersion = () => '0.0.0-test-contract'

const fresh = (what: string): string =>
  `galleon-test-contract-${what}-${randomBytes(6).toString('hex')}`

/**
 * The app's own client as a device of its own on the server.
 *
 * Registered here rather than by the client: the app registers with
 * `allow_existing`, and RomM then hands every client on one host the same
 * device, which would make two devices of a scenario one.
 */
async function device(target: ContractTarget): Promise<RommClient> {
  const name = fresh('device')
  const res = await fetch(`${target.baseUrl}/api/devices`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${target.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      hostname: name,
      client: 'galleon-contract',
      platform: 'linux',
      client_version: '0.0.0',
      allow_existing: false
    })
  })
  assert.ok(res.ok, `register a device: ${res.status} ${await res.clone().text()}`)
  const { device_id: deviceId } = (await res.json()) as { device_id: string }
  const credentials = { accessToken: null, refreshToken: null, clientToken: target.token, deviceId }
  const store = {
    server: { baseUrl: target.baseUrl },
    settings: { deviceId: name, deviceName: name },
    credentials,
    setCredentials: (patch: object) => Object.assign(credentials, patch),
    clearCredentials: () => undefined
  } as unknown as Store
  return new RommClient(store)
}

function scratch(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'galleon-test-contract-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** A save file of `bytes` in the test's scratch folder. */
function file(t: TestContext, bytes: Buffer, name = 'contract.srm'): string {
  const path = join(scratch(t), name)
  writeFileSync(path, bytes)
  return path
}

const md5 = (bytes: Buffer): string => createHash('md5').update(bytes).digest('hex')

/**
 * RomM stamps a slotted upload's name to the second: two uploads in the same
 * second would share a name whatever the server did with them.
 */
async function nextSecond(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 1000 - (Date.now() % 1000) + 50))
}

function isConflict(error: unknown): boolean {
  return error instanceof RommError && error.status === 409
}

export function saveContract(server: string, find: () => Promise<ContractTarget>): void {
  /** A slot of the scenario's own, emptied after it. */
  async function setUp(t: TestContext): Promise<{
    target: ContractTarget
    slot: string
    inSlot: () => Promise<RommSave[]>
  }> {
    const found = await find()
    const slot = fresh('slot')
    const reader = await device(found)
    const inSlot = async (): Promise<RommSave[]> =>
      (await reader.saves(found.romId)).filter((save) => save.slot === slot)
    t.after(async () => {
      await reader.deleteSaves((await inSlot()).map((save) => save.id))
    })
    return { target: found, slot, inSlot }
  }

  test(`${server}: a slotted upload is stored under a stamped name with its MD5, and comes back byte for byte`, async (t) => {
    const { target, slot, inSlot } = await setUp(t)
    const fork = await device(target)
    const bytes = randomBytes(4096)
    const saved = await fork.uploadSave(
      target.romId,
      file(t, bytes),
      'Contract Game.srm',
      'snes9x',
      slot
    )

    assert.equal(saved.slot, slot)
    assert.equal(saved.emulator, 'snes9x')
    assert.equal(saved.file_size_bytes, bytes.length)
    assert.equal(saved.content_hash, md5(bytes))
    assert.ok(saved.file_name.startsWith('Contract Game [') && saved.file_name.endsWith('].srm'))
    assert.match(
      saved.file_name.slice('Contract Game '.length),
      /^\[\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d\]/
    )
    assert.deepEqual(
      (await inSlot()).map((save) => save.id),
      [saved.id]
    )

    const back = join(scratch(t), 'back.srm')
    await fork.downloadSave(saved.id, back)
    assert.deepEqual(readFileSync(back), bytes)
  })

  test(`${server}: a zip's content_hash is over its sorted entries, not its bytes`, async (t) => {
    const { target, slot } = await setUp(t)
    const entries = [
      { name: 'SAVE/DATA.BIN', data: randomBytes(2048) },
      { name: 'SAVE/ICON0.PNG', data: randomBytes(512) },
      { name: 'PARAM.SFO', data: randomBytes(256) }
    ]
    const bytes = zip(entries)
    const saved = await (
      await device(target)
    ).uploadSave(target.romId, file(t, bytes, 'contract.zip'), 'Contract Game.zip', 'ppsspp', slot)
    assert.equal(saved.content_hash, contentHash(entries, bytes))
    assert.notEqual(saved.content_hash, md5(bytes))
  })

  test(`${server}: another device's upload into the slot is refused until it holds the newest save`, async (t) => {
    const { target, slot, inSlot } = await setUp(t)
    const first = await device(target)
    const second = await device(target)
    const theirs = await first.uploadSave(
      target.romId,
      file(t, randomBytes(1024)),
      'c.srm',
      'snes9x',
      slot
    )

    const mine = file(t, randomBytes(1024), 'mine.srm')
    await assert.rejects(second.uploadSave(target.romId, mine, 'c.srm', 'snes9x', slot), isConflict)
    assert.deepEqual(
      (await inSlot()).map((save) => save.id),
      [theirs.id]
    )

    await second.downloadSave(theirs.id, join(scratch(t), 'theirs.srm'))
    await assert.rejects(
      second.uploadSave(target.romId, mine, 'c.srm', 'snes9x', slot),
      isConflict,
      'a download without optimistic records nothing'
    )
    await second.confirmSaveDownloaded(theirs.id)
    await nextSecond()
    const after = await second.uploadSave(target.romId, mine, 'c.srm', 'snes9x', slot)
    assert.deepEqual((await inSlot()).map((save) => save.id).sort(), [theirs.id, after.id].sort())
  })

  test(`${server}: the player's 'keep this device's save' goes in over a save the device never held`, async (t) => {
    const { target, slot, inSlot } = await setUp(t)
    const theirs = await (
      await device(target)
    ).uploadSave(target.romId, file(t, randomBytes(1024)), 'c.srm', 'snes9x', slot)
    await nextSecond()
    const bytes = randomBytes(1024)
    const kept = await (
      await device(target)
    ).uploadSave(target.romId, file(t, bytes, 'kept.srm'), 'c.srm', 'snes9x', slot, {
      keepThisDevice: true
    })
    assert.equal(kept.content_hash, md5(bytes))
    assert.deepEqual((await inSlot()).map((save) => save.id).sort(), [theirs.id, kept.id].sort())
  })

  test(`${server}: identical bytes uploaded again add no copy to the slot`, async (t) => {
    const { target, slot, inSlot } = await setUp(t)
    const fork = await device(target)
    const path = file(t, randomBytes(1024))
    const first = await fork.uploadSave(target.romId, path, 'c.srm', 'snes9x', slot)
    await nextSecond()
    const again = await fork.uploadSave(target.romId, path, 'c.srm', 'snes9x', slot)
    assert.equal(again.id, first.id)
    assert.equal((await inSlot()).length, 1)
  })

  test(`${server}: a listing that names a device reads its record of each save`, async (t) => {
    const { target, slot } = await setUp(t)
    const first = await device(target)
    const second = await device(target)
    const saved = await first.uploadSave(
      target.romId,
      file(t, randomBytes(1024)),
      'c.srm',
      'snes9x',
      slot
    )
    const current = async (who: RommClient): Promise<boolean | undefined> => {
      const id = await who.deviceId()
      assert.ok(id, 'the device registered')
      const row = (await who.savesForDevice(target.romId, id)).find((save) => save.id === saved.id)
      return row?.device_syncs?.find((sync) => sync.device_id === id)?.is_current
    }

    assert.equal(await current(first), true)
    assert.equal(await current(second), false)
    await second.downloadSave(saved.id, join(scratch(t), 'back.srm'))
    assert.equal(await current(second), false, 'reading the bytes is not holding them')
    await second.confirmSaveDownloaded(saved.id)
    assert.equal(await current(second), true)
  })

  test(`${server}: deleted saves are gone from the listing`, async (t) => {
    const { target, slot, inSlot } = await setUp(t)
    const fork = await device(target)
    const saved = await fork.uploadSave(
      target.romId,
      file(t, randomBytes(1024)),
      'c.srm',
      'snes9x',
      slot
    )
    await fork.deleteSaves([saved.id])
    assert.deepEqual(await inSlot(), [])
  })

  /** A name of the scenario's own under no slot, its save removed after it. */
  async function setUpNamed(t: TestContext): Promise<{ target: ContractTarget; name: string }> {
    const found = await find()
    const name = `${fresh('named')}.srm`
    const reader = await device(found)
    t.after(async () => {
      const rows = (await reader.saves(found.romId)).filter((save) => save.file_name === name)
      await reader.deleteSaves(rows.map((save) => save.id))
    })
    return { target: found, name }
  }

  test(`${server}: the player's 'keep this device's save' adds a copy even when older bytes in the slot match`, async (t) => {
    const { target, slot, inSlot } = await setUp(t)
    const first = await device(target)
    const old = file(t, randomBytes(1024), 'old.srm')
    const before = await first.uploadSave(target.romId, old, 'c.srm', 'snes9x', slot)
    await nextSecond()
    await first.uploadSave(
      target.romId,
      file(t, randomBytes(1024), 'new.srm'),
      'c.srm',
      'snes9x',
      slot
    )
    await nextSecond()
    const kept = await (
      await device(target)
    ).uploadSave(target.romId, old, 'c.srm', 'snes9x', slot, {
      keepThisDevice: true
    })
    assert.notEqual(kept.id, before.id)
    assert.equal((await inSlot()).length, 3)
  })

  test(`${server}: a save under no slot keeps its name and is replaced in place`, async (t) => {
    const { target, name } = await setUpNamed(t)
    const fork = await device(target)
    const first = await fork.uploadSave(
      target.romId,
      file(t, randomBytes(1024)),
      name,
      'snes9x',
      null
    )
    await nextSecond()
    const bytes = randomBytes(1024)
    const second = await fork.uploadSave(
      target.romId,
      file(t, bytes, 'b.srm'),
      name,
      'snes9x',
      null
    )
    assert.equal(second.id, first.id)
    assert.equal(second.file_name, name)
    assert.equal(second.slot, null)
    const back = join(scratch(t), 'back.srm')
    await fork.downloadSave(second.id, back)
    assert.deepEqual(readFileSync(back), bytes)
  })

  test(`${server}: under no slot, only a device whose record is older is refused`, async (t) => {
    const { target, name } = await setUpNamed(t)
    const first = await device(target)
    const second = await device(target)
    await first.uploadSave(target.romId, file(t, randomBytes(1024)), name, 'snes9x', null)
    await nextSecond()
    await second.uploadSave(target.romId, file(t, randomBytes(1024), 'b.srm'), name, 'snes9x', null)
    await nextSecond()
    const mine = file(t, randomBytes(1024), 'mine.srm')
    await assert.rejects(first.uploadSave(target.romId, mine, name, 'snes9x', null), isConflict)
    await first.uploadSave(target.romId, mine, name, 'snes9x', null, { keepThisDevice: true })
  })
}
