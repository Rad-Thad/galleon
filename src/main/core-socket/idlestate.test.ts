import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { busyReason, idleState, runtimeDir, writeIdleState } from './idlestate.ts'

/**
 * The bridge takes the screen from Galleon only when this file says idle, so
 * every way of being busy has to read as not idle, and the file has to be
 * readable whole at any moment.
 */
const quiet = { gameRunning: false, activeDownloads: 0, pendingUploads: 0 }
const at = new Date('2026-10-16T06:00:00.000Z')

describe('busyReason and idleState', () => {
  test('nothing running, downloading or waiting is idle', () => {
    assert.equal(busyReason(quiet), null)
    assert.deepEqual(idleState(quiet, '3456789012', at), {
      schema: 1,
      idle: true,
      steamAppId: '3456789012',
      updatedAt: '2026-10-16T06:00:00.000Z'
    })
  })

  test('a running game is not idle', () => {
    const activity = { ...quiet, gameRunning: true }
    assert.equal(busyReason(activity), 'game-running')
    assert.equal(idleState(activity, null, at).idle, false)
  })

  test('an active download is not idle', () => {
    const activity = { ...quiet, activeDownloads: 1 }
    assert.equal(busyReason(activity), 'downloading')
    assert.equal(idleState(activity, null, at).idle, false)
  })

  test('a save waiting to upload is not idle', () => {
    const activity = { ...quiet, pendingUploads: 2 }
    assert.equal(busyReason(activity), 'upload-pending')
    assert.equal(idleState(activity, null, at).idle, false)
  })

  test('the game is the reason given when everything is busy at once', () => {
    assert.equal(
      busyReason({ gameRunning: true, activeDownloads: 3, pendingUploads: 1 }),
      'game-running'
    )
    assert.equal(busyReason({ ...quiet, activeDownloads: 1, pendingUploads: 1 }), 'downloading')
  })

  test('outside Steam the app id is null', () => {
    assert.equal(idleState(quiet, null, at).steamAppId, null)
  })
})

describe('runtimeDir', () => {
  test('galleon under the runtime directory', () => {
    assert.equal(runtimeDir({ XDG_RUNTIME_DIR: '/run/user/1000' }), '/run/user/1000/galleon')
  })

  test('none without an absolute runtime directory, rather than a shared fallback', () => {
    assert.equal(runtimeDir({}), null)
    assert.equal(runtimeDir({ XDG_RUNTIME_DIR: '' }), null)
    assert.equal(runtimeDir({ XDG_RUNTIME_DIR: 'run/user/1000' }), null)
  })
})

describe('writeIdleState', () => {
  let root: string | null = null
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
    root = null
  })

  test('writes the state whole, owner-only, in a folder only the owner can enter', () => {
    root = mkdtempSync(join(tmpdir(), 'idlestate-'))
    const dir = join(root, 'galleon')
    const state = idleState(quiet, '42', at)
    writeIdleState(dir, state)
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')), state)
    assert.equal(statSync(join(dir, 'state.json')).mode & 0o777, 0o600)
    assert.equal(statSync(dir).mode & 0o777, 0o700)
    assert.deepEqual(readdirSync(dir), ['state.json'])
  })

  test('an existing folder or leftover temporary file is made owner-only', () => {
    root = mkdtempSync(join(tmpdir(), 'idlestate-'))
    const dir = join(root, 'galleon')
    mkdirSync(dir, { mode: 0o755 })
    chmodSync(dir, 0o755)
    writeFileSync(join(dir, 'state.json.tmp'), 'stale', { mode: 0o644 })
    writeIdleState(dir, idleState(quiet, '42', at))
    assert.equal(statSync(dir).mode & 0o777, 0o700)
    assert.equal(statSync(join(dir, 'state.json')).mode & 0o777, 0o600)
    assert.deepEqual(readdirSync(dir), ['state.json'])
  })

  test('a later state replaces the earlier one', () => {
    root = mkdtempSync(join(tmpdir(), 'idlestate-'))
    const dir = join(root, 'galleon')
    writeIdleState(dir, idleState(quiet, '42', at))
    writeIdleState(dir, idleState({ ...quiet, gameRunning: true }, '42', at))
    assert.equal(JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')).idle, false)
    assert.deepEqual(readdirSync(dir), ['state.json'])
  })

  test('the file the bridge reads is the one it expects', () => {
    root = mkdtempSync(join(tmpdir(), 'idlestate-'))
    const dir = runtimeDir({ XDG_RUNTIME_DIR: root })
    assert.ok(dir)
    writeIdleState(dir, idleState(quiet, '42', at))
    assert.equal(JSON.parse(readFileSync(join(root, 'galleon', 'state.json'), 'utf8')).idle, true)
  })
})
