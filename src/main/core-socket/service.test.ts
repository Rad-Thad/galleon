import assert from 'node:assert/strict'
import { afterEach, describe, mock, test } from 'node:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CoreDownload } from '@shared/types'
import {
  activityOf,
  coreHandler,
  coreStatus,
  STATE_REFRESH_MS,
  startCoreService,
  steamAppIdOf,
  type CoreObservation,
  type CoreService
} from './service.ts'
import { CoreSocketInUseError } from './server.ts'

/**
 * `status`, `quit-app` and the state file must give the same answer to "is
 * Galleon idle", since the bridge reads the file and then asks the socket.
 */
const quiet: CoreObservation = { connected: true, playing: null, downloads: [], pendingUploads: [] }

function row(state: CoreDownload['state']): CoreDownload {
  return { romId: 7, name: 'Game', state, receivedBytes: 10, totalBytes: 100 }
}

describe('activityOf and coreStatus', () => {
  test('a quiet Galleon is idle', () => {
    assert.deepEqual(coreStatus(quiet), {
      connected: true,
      playing: null,
      downloads: [],
      pendingUploads: [],
      idle: true,
      busy: null
    })
  })

  test('a game being played is busy, and named', () => {
    const status = coreStatus({ ...quiet, playing: 12 })
    assert.deepEqual(status.playing, { romId: 12 })
    assert.equal(status.busy, 'game-running')
  })

  test('a download on the wire or after its last byte is busy, a stopped one is not', () => {
    for (const state of [
      'queued',
      'downloading',
      'checking',
      'extracting',
      'installing'
    ] as const) {
      assert.equal(activityOf({ ...quiet, downloads: [row(state)] }).activeDownloads, 1, state)
    }
    for (const state of ['paused', 'stalled'] as const) {
      const status = coreStatus({ ...quiet, downloads: [row(state)] })
      assert.equal(status.idle, true, state)
      assert.deepEqual(status.downloads, [row(state)], 'still listed with its progress')
    }
  })

  test('a save waiting to go up is busy', () => {
    assert.equal(coreStatus({ ...quiet, pendingUploads: [3] }).busy, 'upload-pending')
  })
})

describe('coreHandler', () => {
  function handler(observed: CoreObservation) {
    const quits: string[] = []
    return {
      quits,
      handle: coreHandler({ observe: () => observed, quitApp: () => quits.push('quit') })
    }
  }

  test('status answers what is observed', async () => {
    const { handle } = handler({ ...quiet, playing: 4 })
    assert.deepEqual(await handle({ cmd: 'status' }), {
      ok: true,
      result: coreStatus({ ...quiet, playing: 4 })
    })
  })

  test('quit-app quits an idle Galleon, after answering', async () => {
    const { handle, quits } = handler(quiet)
    assert.deepEqual(await handle({ cmd: 'quit-app' }), { ok: true, result: { quitting: true } })
    assert.deepEqual(quits, [], 'not before the answer is out')
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(quits, ['quit'])
  })

  test('quit-app refuses with the reason, and does not quit', async () => {
    const cases: Array<[CoreObservation, string]> = [
      [{ ...quiet, playing: 1 }, 'game-running'],
      [{ ...quiet, downloads: [row('downloading')] }, 'downloading'],
      [{ ...quiet, pendingUploads: [1] }, 'upload-pending']
    ]
    for (const [observed, reason] of cases) {
      const { handle, quits } = handler(observed)
      assert.deepEqual(await handle({ cmd: 'quit-app' }), { ok: false, error: reason })
      await new Promise((resolve) => setImmediate(resolve))
      assert.deepEqual(quits, [], reason)
    }
  })

  test('commands not yet wired are answered failed', async () => {
    const { handle } = handler(quiet)
    for (const cmd of ['quit-emulator', 'pause-downloads', 'resume-downloads'] as const) {
      assert.deepEqual(await handle({ cmd }), { ok: false, error: 'failed' }, cmd)
    }
  })
})

describe('steamAppIdOf', () => {
  test('reads the ids in armada launcher order, and none outside Steam', () => {
    assert.equal(steamAppIdOf({ STEAM_COMPAT_APP_ID: '1', SteamAppId: '2', SteamGameId: '3' }), '1')
    assert.equal(steamAppIdOf({ SteamAppId: '2', SteamGameId: '3' }), '2')
    assert.equal(steamAppIdOf({ SteamGameId: '3' }), '3')
    assert.equal(steamAppIdOf({ SteamAppId: '' }), null)
    assert.equal(steamAppIdOf({}), null)
  })
})

describe('startCoreService', () => {
  let root: string | null = null
  const services: CoreService[] = []

  afterEach(async () => {
    while (services.length) await services.pop()!.close()
    if (root) rmSync(root, { recursive: true, force: true })
    root = null
  })

  async function start(observe: () => CoreObservation, quitApp = () => {}) {
    root = mkdtempSync(join(tmpdir(), 'coreservice-'))
    const service = await startCoreService({
      env: { XDG_RUNTIME_DIR: root, SteamAppId: '3456789012' },
      observe,
      quitApp,
      now: () => new Date('2026-10-16T07:00:00.000Z')
    })
    assert.ok(service)
    services.push(service)
    return { service, dir: join(root, 'galleon') }
  }

  function readState(dir: string) {
    return JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'))
  }

  function ask(path: string, line: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const client = createConnection(path, () => client.write(`${line}\n`))
      let text = ''
      client.setEncoding('utf8')
      client.on('data', (data: string) => {
        text += data
        if (text.includes('\n')) {
          client.destroy()
          resolve(JSON.parse(text))
        }
      })
      client.on('error', reject)
    })
  }

  test('without a runtime directory there is nothing to start', async () => {
    const service = await startCoreService({ env: {}, observe: () => quiet, quitApp: () => {} })
    assert.equal(service, null)
  })

  test('writes the state file at once, with the Steam id', async () => {
    const { dir } = await start(() => quiet)
    assert.deepEqual(readState(dir), {
      schema: 1,
      idle: true,
      steamAppId: '3456789012',
      updatedAt: '2026-10-16T07:00:00.000Z'
    })
    assert.equal(statSync(join(dir, 'state.json')).mode & 0o777, 0o600)
  })

  test('the file is written again on a timer while nothing changes', async (t) => {
    // The bridge's limit, from the acceptance: at least every 30 seconds.
    assert.ok(STATE_REFRESH_MS <= 30_000)
    mock.timers.enable({ apis: ['setInterval'] })
    t.after(() => mock.timers.reset())
    const { dir } = await start(() => quiet)
    const path = join(dir, 'state.json')
    rmSync(path)
    mock.timers.tick(STATE_REFRESH_MS)
    assert.equal(readState(dir).idle, true)
    rmSync(path)
    mock.timers.tick(STATE_REFRESH_MS)
    assert.equal(existsSync(path), true)
  })

  test('refresh writes when idle changes, and only then', async () => {
    let observed = quiet
    const { service, dir } = await start(() => observed)
    const path = join(dir, 'state.json')
    const first = statSync(path).mtimeMs
    rmSync(path)
    service.refresh()
    assert.equal(existsSync(path), false, 'unchanged, so not written')

    observed = { ...quiet, playing: 9 }
    service.refresh()
    assert.equal(readState(dir).idle, false)
    assert.ok(statSync(path).mtimeMs >= first)

    observed = quiet
    service.refresh()
    assert.equal(readState(dir).idle, true)
  })

  test('status and quit-app over the socket answer from the same picture', async () => {
    let observed: CoreObservation = { ...quiet, pendingUploads: [5] }
    let quit = 0
    const { dir } = await start(
      () => observed,
      () => quit++
    )
    const sock = join(dir, 'core.sock')
    assert.deepEqual(await ask(sock, '{"id":1,"cmd":"status"}'), {
      id: 1,
      ok: true,
      result: coreStatus(observed)
    })
    assert.deepEqual(await ask(sock, '{"id":2,"cmd":"quit-app"}'), {
      id: 2,
      ok: false,
      error: 'upload-pending'
    })
    assert.equal(quit, 0)

    observed = quiet
    assert.deepEqual(await ask(sock, '{"id":3,"cmd":"quit-app"}'), {
      id: 3,
      ok: true,
      result: { quitting: true }
    })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(quit, 1)
  })

  test('close removes the socket and the state file', async () => {
    const { service, dir } = await start(() => quiet)
    services.pop()
    await service.close()
    assert.equal(existsSync(join(dir, 'core.sock')), false)
    assert.equal(existsSync(join(dir, 'state.json')), false)
  })

  test('nothing is written once it is closed, whatever changes', async () => {
    let observed: CoreObservation = { ...quiet, downloads: [row('installing')] }
    const { service, dir } = await start(() => observed)
    services.pop()
    await service.close()
    observed = quiet
    service.refresh()
    assert.equal(existsSync(join(dir, 'state.json')), false)
  })

  test('a second Galleon in the same session gives up before touching the state file', async () => {
    let observed: CoreObservation = { ...quiet, playing: 1 }
    const { dir } = await start(() => observed)
    observed = quiet
    await assert.rejects(
      startCoreService({
        env: { XDG_RUNTIME_DIR: root! },
        observe: () => quiet,
        quitApp: () => {}
      }),
      CoreSocketInUseError
    )
    assert.equal(readState(dir).idle, false, "the first one's file stands")
  })
})
