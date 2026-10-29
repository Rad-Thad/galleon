/**
 * `test/device/argosy-shapes.py` (M2-02) against Docker RomM 5.2.0 seeded as
 * an Argosy device: every golden fixture uploaded the way SPEC.md says Argosy
 * sends it, the script run with a test home's sign-in, and its report held to
 * the layout the device check reads and to what it may never carry.
 *
 *   npm run test:saves
 *
 * The saves belong to a user made for this test alone, since RomM lists saves
 * and devices per user: the other suites here change saves of the same games
 * while this runs, and the report must cover exactly what was seeded.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RommRom, RommSave } from '../../src/shared/types/romm.ts'
import { basicAuth, TOKEN_SCOPES } from '../romm/lib.mjs'
import { romNamed, scratch, state } from '../romm/server.ts'
import { FIXTURES, MANIFEST } from './fixtures.mjs'
import type { FixtureEntry } from './fixtures.mjs'

const fixtures = (
  JSON.parse(readFileSync(join(FIXTURES, MANIFEST), 'utf8')) as { fixtures: FixtureEntry[] }
).fixtures

const SCRIPT = 'test/device/argosy-shapes.py'

/** A channel the player named after the game, which the report must not repeat. */
const CHANNEL = 'Galleon Test Cartridge'

async function ok(res: Response, what: string): Promise<Response> {
  if (!res.ok) assert.fail(`${what}: ${res.status} ${await res.text()}`)
  return res
}

/** A user of its own, with a client token of the provisioned scopes. */
async function freshUser(): Promise<{ username: string; token: string }> {
  const user = {
    username: `galleon-shapes-${randomBytes(4).toString('hex')}`,
    password: randomBytes(12).toString('hex')
  }
  await ok(
    await fetch(`${state.baseUrl}/api/users`, {
      method: 'POST',
      headers: { Authorization: basicAuth(state.admin), 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...user, email: `${user.username}@example.invalid`, role: 'editor' })
    }),
    'create a user'
  )
  const res = await ok(
    await fetch(`${state.baseUrl}/api/client-tokens`, {
      method: 'POST',
      headers: { Authorization: basicAuth(user), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: user.username, scopes: TOKEN_SCOPES })
    }),
    'mint its token'
  )
  return { username: user.username, token: ((await res.json()) as { raw_token: string }).raw_token }
}

interface Shape {
  slot: string | null
  emulator: string | null
  namePattern: string
  extension: string
  sizeBytes: number
  updatedAt: string
  hasContentHash: boolean
  read: boolean
  readBytes?: number
  zipByRomm?: boolean
  zipByArgosy?: boolean
  contentHashFollowsRomm?: boolean | null
  hardcoreTrailer?: boolean
  entries?: { name: string; sizeBytes: number; dir: boolean }[] | null
}

interface Report {
  schema: number
  argosyDevices: number
  systems: {
    platform: string
    gamesWithArgosySaves: number
    games: { game: number; saves: Shape[]; savesPerSlot: Record<string, number> }[]
  }[]
}

test("argosy-shapes.py reads Argosy's saves from RomM 5.2.0 and reports their shapes only", async (t) => {
  const { username, token } = await freshUser()
  const api = (path: string, init: RequestInit = {}): Promise<Response> =>
    fetch(`${state.baseUrl}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...init.headers }
    })

  const register = async (client: string, platform: string): Promise<string> => {
    const res = await ok(
      await api('/api/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `${username}-${client}`, platform, client, sync_mode: 'api' })
      }),
      `register ${client}`
    )
    return ((await res.json()) as { device_id: string }).device_id
  }
  const argosy = await register('argosy-launcher', 'android')
  const other = await register('galleon-test', 'linux')

  const upload = async (
    device: string,
    rom: RommRom,
    entry: FixtureEntry,
    slot: string
  ): Promise<RommSave> => {
    const params = new URLSearchParams({
      rom_id: String(rom.id),
      emulator: entry.emulator,
      device_id: device,
      overwrite: 'false',
      slot,
      autocleanup: 'true',
      autocleanup_limit: '10'
    })
    const form = new FormData()
    const bytes = readFileSync(join(FIXTURES, entry.path))
    form.append(
      'saveFile',
      new Blob([bytes], { type: 'application/octet-stream' }),
      entry.uploadName
    )
    const res = await ok(
      await api(`/api/saves?${params.toString()}`, { method: 'POST', body: form }),
      `upload ${entry.path}`
    )
    return (await res.json()) as RommSave
  }

  const roms = new Map<string, RommRom>()
  for (const entry of fixtures) roms.set(entry.rom, await romNamed(entry.rom.split('/').at(-1)!))
  for (const entry of fixtures) {
    const save = await upload(argosy, roms.get(entry.rom)!, entry, 'autosave')
    // RomM names an uploaded save's device by the id registration gave it.
    assert.equal(save.origin_device_id, argosy, `${entry.path}: origin_device_id`)
  }
  const snes = fixtures.find((entry) => entry.system === 'snes')!
  await upload(argosy, roms.get(snes.rom)!, snes, CHANNEL)
  // Another client's save of the same game, in a slot of its own since the
  // autosave slot already has Argosy's: the report leaves it out.
  await upload(other, roms.get(snes.rom)!, snes, 'desk')

  // What a read must leave as it was: the devices (a sync record or a heartbeat
  // shows up as last_seen) and every save row, with its device syncs.
  const snapshot = async (): Promise<string> => {
    const listed = (await (await ok(await api('/api/devices'), 'list devices')).json()) as {
      id: string
    }[]
    const devices = listed.filter((device) => device.id === argosy || device.id === other)
    const rows = []
    for (const rom of roms.values()) {
      rows.push(await (await ok(await api(`/api/saves?rom_id=${rom.id}`), 'list saves')).json())
    }
    return JSON.stringify({ devices, rows })
  }
  const before = await snapshot()

  const home = scratch(t)
  mkdirSync(join(home, 'config'))
  writeFileSync(
    join(home, 'config', 'settings.json'),
    JSON.stringify({ server: { baseUrl: state.baseUrl } })
  )
  writeFileSync(
    join(home, 'config', 'credentials.bin'),
    Buffer.concat([Buffer.from('RAW1'), Buffer.from(JSON.stringify({ clientToken: token }))])
  )
  const out = join(home, 'report.json')
  const run = spawnSync('python3', ['-B', SCRIPT, 'report', '--home', home, '--out', out], {
    encoding: 'utf8'
  })
  assert.equal(run.status, 0, `exit ${run.status}: ${run.stderr}`)
  assert.equal(await snapshot(), before, 'the script changed a device or a save')

  const text = readFileSync(out, 'utf8')
  const report = JSON.parse(text) as Report
  assert.equal(report.schema, 1)
  assert.equal(report.argosyDevices, 1)

  // Every system Argosy saved for, by RomM's slug, and no other.
  const platforms = (await (await ok(await api('/api/platforms'), 'list platforms')).json()) as {
    id: number
    slug: string
  }[]
  const slugOf = (rom: RommRom): string => platforms.find((p) => p.id === rom.platform_id)!.slug
  const bySystem = new Map<string, FixtureEntry[]>()
  for (const entry of fixtures) {
    const slug = slugOf(roms.get(entry.rom)!)
    bySystem.set(slug, [...(bySystem.get(slug) ?? []), entry])
  }
  assert.deepEqual(report.systems.map((s) => s.platform).sort(), [...bySystem.keys()].sort())

  for (const system of report.systems) {
    const seeded = bySystem.get(system.platform)!
    const games = new Set(seeded.map((entry) => entry.rom)).size
    assert.equal(system.gamesWithArgosySaves, games, system.platform)
    assert.equal(system.games.length, Math.min(games, 3), system.platform)
    const saves = system.games.flatMap((game) => game.saves)
    const channel = system.platform === slugOf(roms.get(snes.rom)!) ? 1 : 0
    // The other client's save is not among them.
    assert.equal(saves.length, seeded.length + channel, system.platform)
    for (const game of system.games) {
      const counted = Object.values(game.savesPerSlot).reduce((a, b) => a + b, 0)
      assert.equal(counted, game.saves.length)
    }
    for (const shape of saves) {
      const entry = seeded.find((e) => e.emulator === shape.emulator && e.bytes === shape.sizeBytes)
      assert.ok(entry, `${system.platform}: a save no fixture made: ${JSON.stringify(shape)}`)
      const ext = entry.uploadName.slice(entry.uploadName.lastIndexOf('.') + 1)
      assert.equal(shape.read, true)
      assert.equal(shape.readBytes, entry.bytes)
      assert.equal(shape.hasContentHash, true)
      assert.equal(shape.contentHashFollowsRomm, true, `${entry.path}: content_hash`)
      assert.equal(shape.zipByRomm, entry.shape === 'zip', entry.path)
      assert.equal(shape.zipByArgosy, entry.shape === 'zip', entry.path)
      assert.equal(shape.hardcoreTrailer, false)
      assert.equal(shape.extension, ext)
      assert.match(shape.updatedAt, /^\d{4}-\d\d-\d\dT/)
      if (shape.slot === 'autosave') {
        assert.equal(shape.namePattern, `<rom> [<timestamp>].${ext}`, entry.path)
      } else {
        assert.equal(shape.slot, '<channel-1>', 'a named channel is published by number')
      }
      if (entry.shape === 'zip') {
        const files = shape.entries!.filter((e) => !e.dir)
        assert.deepEqual(
          files.map((e) => e.sizeBytes).sort((a, b) => a - b),
          entry.entries!.map((e) => e.bytes).sort((a, b) => a - b),
          entry.path
        )
      } else {
        assert.equal(shape.entries, undefined)
      }
    }
  }

  // Nothing that names the server, the account or a game.
  const url = new URL(state.baseUrl)
  for (const secret of [token, state.baseUrl, url.host, username, CHANNEL, 'Galleon Test']) {
    assert.ok(
      !text.includes(secret),
      `the report carries ${secret === token ? 'the token' : secret}`
    )
  }
  for (const entry of fixtures) {
    const stem = entry.rom
      .split('/')
      .at(-1)!
      .replace(/\.[^.]+$/, '')
    assert.ok(!text.includes(stem), `the report names ${stem}`)
  }
})
