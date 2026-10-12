/**
 * The calls that write, made by RomMix's own client against a provisioned
 * Docker RomM: device registration, save and state round trips and play
 * sessions, beside firmware and the whole-game archive. Every request each
 * test sends is held to the server version's document in `schema/`.
 *
 *   npm run test:romm
 *   ROMM_PROFILE=v520 npm run test:romm-real
 *
 * Only ever against the disposable servers in compose.yml: each run adds a
 * device, a save, a state and a play session to the server it is pointed at.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PlayReporter } from '../../src/main/playtime.ts'
import { UnreachableError } from '../../src/main/romm/index.ts'
import { instant } from '../../src/main/savedecide.ts'
import { Store } from '../../src/main/store.ts'
import { assertFitsSchema, client, md5, romNamed, scratch, state, watch } from './server.ts'

/**
 * A machine identifier no earlier run used. RomM may still answer with a
 * device it already holds under the same name and hostname, since the
 * client registers with `allow_existing`.
 */
const fresh = (): string => `galleon-test-romm-${randomBytes(6).toString('hex')}`

test('firmware lists the stubs, and one downloads with its md5 checked', async (t) => {
  const sent = watch()
  const firmware = await client().firmware()
  const item = firmware.find((f) => f.file_name === 'scph5501.bin')
  assert.ok(item, `no scph5501.bin among ${firmware.map((f) => f.file_name).join(', ')}`)
  assert.ok(item.md5_hash, 'the scan recorded no md5 for the firmware')

  const destination = join(scratch(t), item.file_name)
  await client().downloadFirmware(item, destination)
  assert.equal(md5(destination), item.md5_hash)
  assertFitsSchema(sent)
})

test('a multi-file game downloads whole as one archive of its discs', async (t) => {
  const rom = await romNamed('Galleon Test Saga (USA)')
  assert.equal(rom.has_multiple_files, true)

  const sent = watch()
  const destination = join(scratch(t), `${rom.fs_name}.zip`)
  await client().downloadRom(rom, destination, () => undefined, new AbortController().signal)

  // A zip names its members in plain bytes, which is enough to see both discs
  // went in without unpacking it here; unpacking is `downloads.ts`'s, and
  // tested there.
  const bytes = readFileSync(destination)
  assert.equal(bytes.subarray(0, 4).toString('latin1'), 'PK\x03\x04')
  for (const file of rom.files) assert.ok(bytes.includes(file.file_name), file.file_name)
  assertFitsSchema(sent)
})

test('a machine registers once however often it asks, and is listed', async () => {
  const identifier = fresh()
  const sent = watch()
  const rommix = client(identifier)
  const id = await rommix.deviceId()
  assert.ok(id, 'registration named no device id')
  assert.equal(await rommix.deviceId(), id, 'asked twice, registered twice')
  assert.ok((await client().devices()).some((device) => device.id === id))
  assert.equal(sent.filter((s) => s.method === 'POST' && s.url.endsWith('/api/devices')).length, 1)
  assertFitsSchema(sent)
})

test('a save goes up under this device and comes back byte for byte', async (t) => {
  const rom = await romNamed('Galleon Test Handheld (Europe).gba')
  const dir = scratch(t)
  const source = join(dir, 'up.sav')
  const payload = randomBytes(2048)
  writeFileSync(source, payload)
  const fileName = `Galleon Test Handheld (Europe) ${randomBytes(4).toString('hex')}.sav`

  const sent = watch()
  const rommix = client(fresh())
  const saved = await rommix.uploadSave(rom.id, source, fileName, null, null)
  assert.equal(saved.rom_id, rom.id)
  const upload = sent.find((s) => s.method === 'POST' && s.url.includes('/api/saves?'))
  assert.equal(new URL(upload!.url).searchParams.get('device_id'), await rommix.deviceId())
  const listed = (await rommix.saves(rom.id)).find((save) => save.id === saved.id)
  assert.ok(listed, 'the uploaded save is not listed')

  const back = join(dir, 'down.sav')
  await rommix.downloadSave(saved.id, back)
  assert.deepEqual(readFileSync(back), payload)
  assertFitsSchema(sent)
})

test('a state goes up and comes back byte for byte', async (t) => {
  const rom = await romNamed('Galleon Test Handheld (Europe).gba')
  const dir = scratch(t)
  const source = join(dir, 'up.state')
  const payload = randomBytes(4096)
  writeFileSync(source, payload)
  const fileName = `Galleon Test Handheld (Europe) ${randomBytes(4).toString('hex')}.state`

  const sent = watch()
  const saved = await client().uploadState(rom.id, source, fileName, null)
  assert.equal(saved.rom_id, rom.id)
  assert.ok((await client().states(rom.id)).some((s) => s.id === saved.id))

  const back = join(dir, 'down.state')
  await client().downloadState(saved.id, back)
  assert.equal(
    createHash('sha256').update(readFileSync(back)).digest('hex'),
    createHash('sha256').update(payload).digest('hex')
  )
  assertFitsSchema(sent)
})

test('play sessions are accepted, listed and counted in the play time', async (t) => {
  const rom = await romNamed('Galleon Test Cartridge (USA).sfc')
  const rommix = client(fresh())
  const before = await rommix.playTime(rom.id)
  const kept = new Store(scratch(t))

  // Played away from the server: kept, not lost.
  const offline = new PlayReporter(kept, {
    sendPlaySessions: () => Promise.reject(new UnreachableError('no network'))
  })
  const endedAt = new Date(Math.floor(Date.now() / 1000) * 1000 - 60_000)
  const startedAt = new Date(endedAt.getTime() - 90_000)
  await offline.record(rom.id, startedAt, endedAt)
  await offline.record(rom.id, new Date(endedAt.getTime() - 3000), endedAt)
  assert.equal(kept.unsentPlay.length, 1)

  const sent = watch()
  await new PlayReporter(kept, rommix).send()
  assert.deepEqual(kept.unsentPlay, [])
  assertFitsSchema(sent)

  const params = new URLSearchParams({
    rom_id: String(rom.id),
    start_after: startedAt.toISOString()
  })
  const res = await fetch(`${state.baseUrl}/api/play-sessions?${params.toString()}`, {
    headers: { Authorization: `Bearer ${state.clientToken}` }
  })
  assert.ok(res.ok, `play sessions: ${res.status}`)
  const listed = (await res.json()) as { rom_id: number; start_time: string; duration_ms: number }[]
  const ours = listed.filter((row) => instant(row.start_time) === startedAt.getTime() * 1000)
  assert.equal(ours.length, 1, JSON.stringify(listed))
  assert.equal(ours[0].duration_ms, 90_000)
  assert.equal(await rommix.playTime(rom.id), before + 90)
})
