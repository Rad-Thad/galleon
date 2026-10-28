import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { CARD_MIN_FREE_BYTES } from '@shared/librarycard'
import { NOTICES, SHARED_LIBRARY, type InstalledRom, type Settings } from '@shared/types'
import { RomMixApp, assetRequestPath, isAssetPath } from './app.ts'
import { ReadOnlyGuard } from './romm/guard.ts'

/**
 * What the image protocol will serve.
 *
 * The scheme is registered `supportFetchAPI` and `bypassCSP`, and every request
 * through it carries the bearer token — so the path decides whether the page
 * can read one of RomM's pictures or any endpoint the token reaches. The rule
 * is checked here rather than through a window because it is a string question,
 * and because a path it wrongly turns down is a picture that silently never
 * draws.
 */

test('every picture RomM serves is under its assets root', () => {
  assert.equal(isAssetPath('/assets/romm/resources/roms/1/cover/small.png'), true)
  assert.equal(isAssetPath('/assets/romm/assets/users/1/avatar.png'), true)
  // The face RomM serves for an account that uploaded none — see `Avatar`.
  assert.equal(isAssetPath('assets/default/user.svg'), true)
  // Handed out by RomM without the leading slash as often as with it.
  assert.equal(isAssetPath('assets/romm/resources/roms/1/cover/big.png'), true)
})

test('anything else the token would answer for is refused', () => {
  assert.equal(isAssetPath('/api/users/me'), false)
  assert.equal(isAssetPath('/api/roms'), false)
  assert.equal(isAssetPath(''), false)
})

test('a path that climbs out of the assets root is not an asset path', () => {
  assert.equal(isAssetPath('/assets/../api/users/me'), false)
  assert.equal(isAssetPath('assets/romm/../../api/token'), false)
})

test('a path the URL parser would climb with is refused as well', () => {
  assert.equal(isAssetPath('/assets/%2e%2e/api/users/me'), false)
  assert.equal(isAssetPath('/assets/romm/%2E%2E/%2e%2e/api/token'), false)
})

/**
 * RomM 5.2.0 hands a manual out relative to its resources folder, so the Manual
 * tab asked for a path the protocol refused and drew nothing.
 */
test('a manual RomM holds is served from under its resources root', () => {
  assert.equal(
    assetRequestPath('roms/3/14/manual/14.pdf'),
    '/assets/romm/resources/roms/3/14/manual/14.pdf'
  )
  // Everything an asset path already was stays as it was.
  assert.equal(
    assetRequestPath('/assets/romm/resources/roms/1/cover/small.png'),
    '/assets/romm/resources/roms/1/cover/small.png'
  )
})

test('a manual path that climbs, or is absolute, is still refused', () => {
  assert.equal(assetRequestPath('roms/3/14/manual/../../../../../api/users/me'), null)
  assert.equal(assetRequestPath('roms/3/14/manual/..'), null)
  assert.equal(assetRequestPath('roms/3/14/manual/%2e%2e'), null)
  assert.equal(assetRequestPath('/roms/3/14/manual/14.pdf'), null)
  assert.equal(assetRequestPath('/etc/passwd'), null)
  assert.equal(assetRequestPath('roms/3/14/manual/sub/14.pdf'), null)
  assert.equal(assetRequestPath('api/users/me'), null)
  assert.equal(assetRequestPath(''), null)
})

test('under the read-only guard the catch-up sends nothing', async () => {
  // A catch-up that ran would touch the store, the client and the offline
  // cache; a held one touches none of them, so a bare receiver proves it.
  const held = Object.create(RomMixApp.prototype) as RomMixApp
  const guard = new ReadOnlyGuard()
  let guarded: ReadOnlyGuard | null = null
  Object.assign(held, { client: { readOnly: (g: ReadOnlyGuard) => (guarded = g) } })
  held.readOnly(guard)
  assert.equal(guarded, guard)
  await held.catchUp()
  assert.equal(guard.serverWritesAttempted, 0)
})

test('a self-test home has every notice dismissed, keeping what was already there', () => {
  const app = Object.create(RomMixApp.prototype) as RomMixApp
  let settings = { dismissedNotices: ['earlier'] } as Settings
  let writes = 0
  Object.assign(app, {
    store: {
      get settings() {
        return settings
      },
      updateSettings(patch: Partial<Settings>) {
        writes++
        settings = { ...settings, ...patch }
        return settings
      }
    }
  })
  app.dismissNotices()
  assert.deepEqual(settings.dismissedNotices, ['earlier', ...NOTICES])
  app.dismissNotices()
  assert.equal(writes, 1, 'nothing is written when every notice is already dismissed')
})

test('the core socket sees the game, the live queue and the saves owed', () => {
  const app = Object.create(RomMixApp.prototype) as RomMixApp
  const row = (romId: number, state: string) => ({
    romId,
    name: `Game ${romId}`,
    coverPath: null,
    system: 'snes',
    platformName: 'SNES',
    state,
    receivedBytes: 5,
    totalBytes: 10,
    error: null
  })
  const settings = { syncSavesUp: true }
  Object.assign(app, {
    connection: { current: { connected: true } },
    launcher: { playing: 3 },
    downloads: {
      items: [row(1, 'downloading'), row(2, 'paused'), row(4, 'done'), row(5, 'error')]
    },
    store: { settings, unsentSaves: [{ romId: 8, since: 0 }] }
  })
  assert.deepEqual(app.coreObservation(), {
    connected: true,
    playing: 3,
    downloads: [
      { romId: 1, name: 'Game 1', state: 'downloading', receivedBytes: 5, totalBytes: 10 },
      { romId: 2, name: 'Game 2', state: 'paused', receivedBytes: 5, totalBytes: 10 }
    ],
    pendingUploads: [8]
  })

  // Nothing is ever sent unasked with sending up switched off.
  settings.syncSavesUp = false
  assert.deepEqual(app.coreObservation().pendingUploads, [])
})

/** An app over a stand-in store, recording what it writes to the settings. */
function libraryApp(fresh: boolean): { app: RomMixApp; written: Partial<Settings>[] } {
  const app = Object.create(RomMixApp.prototype) as RomMixApp
  const written: Partial<Settings>[] = []
  Object.assign(app, {
    store: {
      fresh,
      updateSettings(patch: Partial<Settings>) {
        written.push(patch)
      }
    }
  })
  return { app, written }
}

const card = {
  mountPoint: '/run/media/armada/NovaSD',
  fsType: 'ext4',
  label: 'NovaSD',
  readOnly: false,
  freeBytes: CARD_MIN_FREE_BYTES * 10,
  totalBytes: CARD_MIN_FREE_BYTES * 20
}
const onCard = {
  volumes: async () => [card],
  user: 'armada',
  prepare: async () => true
}

test('a fresh installation puts its library on the card, and only a fresh one', async (t) => {
  const home = process.env.GALLEON_HOME
  t.after(() => {
    if (home === undefined) delete process.env.GALLEON_HOME
    else process.env.GALLEON_HOME = home
  })
  delete process.env.GALLEON_HOME

  const fresh = libraryApp(true)
  await fresh.app.chooseDefaultLibrary(onCard)
  assert.deepEqual(fresh.written, [{ libraryRoot: '/run/media/armada/NovaSD/galleon/roms' }])

  const started = libraryApp(false)
  await started.app.chooseDefaultLibrary(onCard)
  assert.deepEqual(started.written, [], 'a library that may hold games is never moved')

  const none = libraryApp(true)
  await none.app.chooseDefaultLibrary({ ...onCard, volumes: async () => [] })
  assert.deepEqual(none.written, [], 'with no card the default stands')
})

test('a home given through GALLEON_HOME keeps its library inside it', async (t) => {
  const home = process.env.GALLEON_HOME
  t.after(() => {
    if (home === undefined) delete process.env.GALLEON_HOME
    else process.env.GALLEON_HOME = home
  })
  process.env.GALLEON_HOME = '/tmp/galleon-selftest-home'

  const { app, written } = libraryApp(true)
  await app.chooseDefaultLibrary({
    ...onCard,
    volumes: async () => assert.fail('the card is not even looked at')
  })
  assert.deepEqual(written, [])
})

for (const state of ['queued', 'downloading', 'checking', 'extracting', 'installing'] as const) {
  test(`the library does not move while a download is ${state}`, async () => {
    // Every stage up to the index entry writes into the library folder, the
    // last ones after the bytes have all arrived.
    const app = Object.create(RomMixApp.prototype) as RomMixApp
    let moved = false
    Object.assign(app, {
      downloads: { items: [{ romId: 1, state }] },
      store: {
        get settings() {
          moved = true
          return { libraryRoot: '' }
        }
      }
    })
    await assert.rejects(app.changeLibraryFolder('/elsewhere'), /while a game is downloading/)
    assert.equal(moved, false, 'refused before anything is planned')
  })
}

test("stock RomMix's games are offered, adopted and announced through the app", async (t) => {
  const saved = [process.env.GALLEON_HOME, process.env.HOME, process.env.XDG_CONFIG_HOME]
  t.after(() => {
    for (const [name, value] of [
      ['GALLEON_HOME', saved[0]],
      ['HOME', saved[1]],
      ['XDG_CONFIG_HOME', saved[2]]
    ] as const) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })
  const home = mkdtempSync(join(tmpdir(), 'galleon-app-stock-test-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  delete process.env.GALLEON_HOME
  delete process.env.XDG_CONFIG_HOME
  process.env.HOME = home
  const game = join(home, 'rommix', 'roms', 'gc', 'one.rvz')
  mkdirSync(join(home, 'rommix', 'config'), { recursive: true })
  mkdirSync(dirname(game), { recursive: true })
  writeFileSync(game, Buffer.alloc(10))
  writeFileSync(
    join(home, 'rommix', 'config', 'settings.json'),
    JSON.stringify({ server: { baseUrl: 'http://romm.test' } })
  )
  writeFileSync(
    join(home, 'rommix', 'config', 'downloaded_roms.json'),
    JSON.stringify({
      roms: [{ romId: 1, path: game, launchPath: game, system: 'gc', emulatorId: SHARED_LIBRARY }]
    })
  )

  const entries = new Map<number, InstalledRom>()
  const sent: string[] = []
  let server: { baseUrl: string } | null = null
  const app = Object.create(RomMixApp.prototype) as RomMixApp
  Object.assign(app, {
    downloads: { items: [] },
    library: { installed: [] },
    send: (channel: string) => sent.push(channel),
    store: {
      get server() {
        return server
      },
      settings: { libraryRoot: '' },
      get installed() {
        return [...entries.values()]
      },
      getInstalled: (romId: number) => entries.get(romId),
      addInstalledMany: (roms: InstalledRom[]) => {
        for (const rom of roms) entries.set(rom.romId, rom)
      }
    }
  })

  assert.equal(await app.stockLibrary(), null, 'nothing before sign-in')
  server = { baseUrl: 'http://romm.test' }
  const offer = await app.stockLibrary()
  assert.equal(offer?.adoptable, 1)
  assert.deepEqual(
    offer?.plan.games.map((each) => [each.romId, each.sizeBytes, each.to]),
    [[1, 10, join(home, 'galleon', 'roms', 'gc', 'one.rvz')]]
  )

  assert.equal(app.adoptStockLibrary(), 1)
  assert.equal(entries.get(1)?.path, game)
  assert.deepEqual(sent, ['library:installed'])
  assert.equal((await app.stockLibrary())?.adoptable, 0, 'still offered for the move')
})
