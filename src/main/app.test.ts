import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CARD_MIN_FREE_BYTES } from '@shared/librarycard'
import { NOTICES, type Settings } from '@shared/types'
import { RomMixApp, isAssetPath } from './app.ts'
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
