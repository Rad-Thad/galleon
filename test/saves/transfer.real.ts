/**
 * Transfers (M2-06) against a real server: what a retried upload leaves in
 * the slot.
 *
 *   npm run test:saves
 *   ROMM_PROFILE=v520 npm run test:saves-real
 *
 * A device on a handheld's Wi-Fi loses replies: the upload went through but
 * the answer never came back, so the same save goes up again. If the server
 * filed each attempt as another copy, every dropped reply would grow the
 * slot's history with duplicates (SPEC.md section 8), and the next negotiate
 * would pair against whichever copy it chose. The client relies on RomM
 * returning the copy it already holds; this holds the server to that.
 *
 * Only ever against the disposable servers in test/romm/compose.yml.
 */
import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RommClient } from '../../src/main/romm/index.ts'
import { client, romNamed, scratch } from '../romm/server.ts'

const fresh = (what: string): string =>
  `galleon-test-transfer-${what}-${randomBytes(6).toString('hex')}`

/**
 * The app's client as a RomM device of this test's own, on a slot of its own
 * for a game no golden fixture uses: the round trips run beside this file
 * against the same server and empty their games' slots.
 */
async function setUp(t: TestContext): Promise<{ fork: RommClient; romId: number; slot: string }> {
  const rom = await romNamed('Galleon Test Plain (USA).iso')
  const fork = client(fresh('device'))
  const slot = fresh('slot')
  t.after(async () => {
    const rows = (await fork.saves(rom.id)).filter((save) => save.slot === slot)
    await fork.deleteSaves(rows.map((save) => save.id))
  })
  return { fork, romId: rom.id, slot }
}

/**
 * Wait for the clock to pass into the next second: RomM stamps a slotted
 * upload's name to the second, and a retry made in the same second would get
 * the same name whatever the server did with it.
 */
async function nextSecond(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 1000 - (Date.now() % 1000) + 50))
}

for (const keepThisDevice of [false, true]) {
  const how = keepThisDevice ? "the player's 'keep this device's save'" : 'an upload'
  test(`${how} retried with identical bytes adds no row to the slot`, async (t) => {
    const { fork, romId, slot } = await setUp(t)
    const file = join(scratch(t), 'retry.srm')
    writeFileSync(file, randomBytes(4096))

    const first = await fork.uploadSave(romId, file, 'retry.srm', 'galleon-test', slot, {
      keepThisDevice
    })
    await nextSecond()
    const again = await fork.uploadSave(romId, file, 'retry.srm', 'galleon-test', slot, {
      keepThisDevice
    })

    assert.equal(again.id, first.id, 'the retry was filed as another save')
    assert.equal(again.file_name, first.file_name)
    assert.equal(again.content_hash, first.content_hash)
    const rows = (await fork.saves(romId)).filter((save) => save.slot === slot)
    assert.deepEqual(
      rows.map((save) => save.id),
      [first.id],
      `the slot holds ${rows.map((save) => save.file_name).join(', ')}`
    )
  })
}

test("a changed save after a retried one is the slot's second row, not a third", async (t) => {
  const { fork, romId, slot } = await setUp(t)
  const file = join(scratch(t), 'retry.srm')
  writeFileSync(file, randomBytes(4096))
  const first = await fork.uploadSave(romId, file, 'retry.srm', 'galleon-test', slot)
  await nextSecond()
  await fork.uploadSave(romId, file, 'retry.srm', 'galleon-test', slot)

  // The next session's save: the same device, so RomM's record of it is
  // current and nothing is refused.
  await nextSecond()
  writeFileSync(file, randomBytes(4096))
  const next = await fork.uploadSave(romId, file, 'retry.srm', 'galleon-test', slot)

  assert.notEqual(next.id, first.id)
  const rows = (await fork.saves(romId)).filter((save) => save.slot === slot)
  assert.deepEqual(
    rows.map((save) => save.id).sort((a, b) => a - b),
    [first.id, next.id].sort((a, b) => a - b)
  )
})
