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
import type { RommSave, RommSyncOperation, RommSyncSave } from '../../src/shared/types/romm.ts'
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

const refused =
  (status: number) =>
  (error: unknown): boolean =>
    error instanceof RommError && error.status === status

/** A time `seconds` after `iso`, as a client reporting a later change would. */
const later = (iso: string, seconds: number): string =>
  new Date(Date.parse(iso) + seconds * 1000).toISOString()

/** How a device reports a save it holds to negotiate. */
function reported(
  romId: number,
  slot: string | null,
  hash: string,
  updatedAt: string,
  fileName = 'c.srm'
): RommSyncSave {
  return {
    rom_id: romId,
    file_name: fileName,
    slot,
    emulator: 'snes9x',
    content_hash: hash,
    updated_at: updatedAt,
    file_size_bytes: 1024
  }
}

/**
 * A device's negotiate, cut down to the operations a scenario owns: 5.2.0
 * answers for the whole library, and the other suites share the server.
 */
async function negotiate(
  who: RommClient,
  saves: RommSyncSave[],
  owns: (op: RommSyncOperation) => boolean
): Promise<{ sessionId: number; operations: RommSyncOperation[] }> {
  const deviceId = await who.deviceId()
  assert.ok(deviceId, 'the device registered')
  const answer = await who.negotiate({ device_id: deviceId, saves })
  return { sessionId: answer.session_id, operations: answer.operations.filter(owns) }
}

const actions = (operations: RommSyncOperation[]): string[] =>
  operations.map((op) => `${op.action} ${op.save_id ?? '-'}`)

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

  test(`${server}: negotiate pairs on game and slot, and never pairs a save under no slot`, async (t) => {
    const { target, slot } = await setUp(t)
    const { name: unslotted } = await setUpNamed(t)
    const empty = fresh('empty')
    const bytes = randomBytes(1024)
    const uploader = await device(target)
    const theirs = await uploader.uploadSave(target.romId, file(t, bytes), 'c.srm', 'snes9x', slot)
    // The same bytes under no slot, which a save under no slot must not pair with.
    await uploader.uploadSave(target.romId, file(t, bytes, 'u.srm'), unslotted, 'snes9x', null)

    const now = new Date().toISOString()
    const { operations } = await negotiate(
      await device(target),
      [
        reported(target.romId, empty, md5(randomBytes(8)), now),
        reported(target.romId, null, md5(bytes), now, unslotted)
      ],
      (op) => op.slot === slot || op.slot === empty || op.file_name === unslotted
    )
    assert.deepEqual(actions(operations), ['upload -', 'upload -', `download ${theirs.id}`])
    assert.equal(operations[2].server_content_hash, md5(bytes))
    assert.equal(operations[2].file_name, theirs.file_name)
  })

  test(`${server}: negotiate decides by what moved since the device's record`, async (t) => {
    const { target, slot, inSlot } = await setUp(t)
    // A time as RomM stores it: an upload's answer can carry more of the
    // second than the row keeps, which would make that time newer than itself.
    const listed = async (id: number): Promise<string> => {
      const row = (await inSlot()).find((save) => save.id === id)
      assert.ok(row, `save ${id} is listed`)
      return row.updated_at
    }
    const first = await device(target)
    const saved = await first.uploadSave(
      target.romId,
      file(t, randomBytes(1024)),
      'c.srm',
      'snes9x',
      slot
    )
    const mine = (who: RommClient, saves: RommSyncSave[]) =>
      negotiate(who, saves, (op) => op.slot === slot)
    const hash = saved.content_hash ?? ''
    const changed = md5(randomBytes(8))

    assert.deepEqual(
      actions(
        (await mine(first, [reported(target.romId, slot, hash, later(saved.updated_at, 60))]))
          .operations
      ),
      [`no_op ${saved.id}`],
      'the same bytes'
    )
    assert.deepEqual(
      actions(
        (await mine(first, [reported(target.romId, slot, changed, later(saved.updated_at, -60))]))
          .operations
      ),
      [`no_op ${saved.id}`],
      'different bytes, but older than the record'
    )
    assert.deepEqual(
      actions(
        (await mine(first, [reported(target.romId, slot, changed, later(saved.updated_at, 60))]))
          .operations
      ),
      [`upload ${saved.id}`]
    )
    assert.deepEqual(actions((await mine(first, [])).operations), [], 'held and not mentioned')

    await nextSecond()
    const second = await device(target)
    const newer = await second.uploadSave(
      target.romId,
      file(t, randomBytes(1024), 'newer.srm'),
      'c.srm',
      'snes9x',
      slot,
      { keepThisDevice: true }
    )
    assert.deepEqual(
      actions(
        (await mine(first, [reported(target.romId, slot, hash, saved.updated_at)])).operations
      ),
      [`download ${newer.id}`]
    )
    assert.deepEqual(
      actions(
        (await mine(first, [reported(target.romId, slot, changed, later(newer.updated_at, 60))]))
          .operations
      ),
      [`upload ${newer.id}`],
      'its record is of an older copy, so the newer side wins, and nothing is a conflict'
    )
    assert.deepEqual(actions((await mine(first, [])).operations), [`download ${newer.id}`])
    assert.deepEqual(actions((await mine(second, [])).operations), [])

    const stranger = await device(target)
    assert.deepEqual(
      actions(
        (
          await mine(stranger, [
            reported(target.romId, slot, changed, later(newer.updated_at, -60))
          ])
        ).operations
      ),
      [`download ${newer.id}`]
    )
    assert.deepEqual(
      actions(
        (await mine(stranger, [reported(target.romId, slot, changed, await listed(newer.id))]))
          .operations
      ),
      [`conflict ${newer.id}`],
      'no record, the same time, different bytes'
    )
  })

  test(`${server}: a negotiate ends the device's open session, and an ended session is refused`, async (t) => {
    const { target } = await setUp(t)
    const fork = await device(target)
    const none = (): boolean => false
    const first = await negotiate(fork, [], none)
    const second = await negotiate(fork, [], none)
    assert.notEqual(first.sessionId, second.sessionId)

    const done = { operations_completed: 0, operations_failed: 0 }
    await assert.rejects(fork.completeSyncSession(first.sessionId, done), refused(400))
    const answer = await fork.completeSyncSession(second.sessionId, done)
    assert.equal(answer.play_session_ingest ?? null, null)
    await assert.rejects(fork.completeSyncSession(second.sessionId, done), refused(400))
    await assert.rejects(fork.completeSyncSession(second.sessionId + 1_000_000, done), refused(404))
    // Another device's negotiate leaves this device's session open.
    const third = await negotiate(fork, [], none)
    await negotiate(await device(target), [], none)
    await fork.completeSyncSession(third.sessionId, done)
  })

  test(`${server}: play sent with a completion is taken once`, async (t) => {
    const { target } = await setUp(t)
    const fork = await device(target)
    // Whole seconds and in the past: RomM drops the fraction, and refuses an
    // end too far ahead of its own clock.
    const endedAt = new Date(Math.floor(Date.now() / 1000) * 1000 - 60_000)
    const span = {
      rom_id: target.romId,
      start_time: new Date(endedAt.getTime() - 300_000).toISOString(),
      end_time: endedAt.toISOString(),
      duration_ms: 300_000
    }
    const ahead = {
      ...span,
      start_time: new Date(Date.now() + 3_600_000).toISOString(),
      end_time: new Date(Date.now() + 3_660_000).toISOString(),
      duration_ms: 60_000
    }
    const complete = async (play: (typeof span)[]) => {
      const { sessionId } = await negotiate(fork, [], () => false)
      const answer = await fork.completeSyncSession(sessionId, {
        operations_completed: 0,
        operations_failed: 0,
        play_sessions: play
      })
      assert.ok(answer.play_session_ingest)
      return answer.play_session_ingest
    }

    const first = await complete([span, ahead])
    assert.equal(first.created_count, 1)
    assert.equal(first.skipped_count, 1)
    assert.deepEqual(first.results.map((r) => `${r.index} ${r.status}`).sort(), [
      '0 created',
      '1 error'
    ])
    // The same span again, as a completion retried after a lost reply would
    // send it, beside another span of the same game.
    const next = {
      ...span,
      start_time: span.end_time,
      end_time: new Date(endedAt.getTime() + 30_000).toISOString(),
      duration_ms: 30_000
    }
    const again = await complete([span, next])
    assert.equal(again.created_count, 1)
    assert.deepEqual(again.results.map((r) => `${r.index} ${r.status}`).sort(), [
      '0 duplicate',
      '1 created'
    ])

    const { sessionId } = await negotiate(fork, [], () => false)
    await assert.rejects(
      fork.completeSyncSession(sessionId, {
        operations_completed: 0,
        operations_failed: 0,
        play_sessions: [{ ...span, end_time: span.start_time }]
      }),
      refused(422)
    )
  })

  test(`${server}: a registration from the same machine gets its own device back, or a 409 without allow_existing`, async () => {
    const target = await find()
    const host = fresh('host')
    const register = async (allowExisting: boolean): Promise<Response> =>
      fetch(`${target.baseUrl}/api/devices`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${target.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: host,
          hostname: host,
          client: 'galleon-contract',
          platform: 'linux',
          client_version: '0.0.0',
          allow_existing: allowExisting
        })
      })

    const first = await register(true)
    assert.ok(first.ok, `register: ${first.status}`)
    const { device_id: id } = (await first.json()) as { device_id: string }
    const again = await register(true)
    assert.ok(again.ok, `register again: ${again.status}`)
    assert.equal(((await again.json()) as { device_id: string }).device_id, id)

    const refusedOne = await register(false)
    assert.equal(refusedOne.status, 409)
    assert.equal(((await refusedOne.json()) as { device_id: string }).device_id, id)
  })
}
