import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { RommDeviceSync, RommSave, RommSyncSave } from '@shared/types'
import { compareSaveState, decideForGame, instant } from './savedecide.ts'

/**
 * The local decision against RomM's rules, written out case by case from
 * `compare_save_state` and negotiate's pairing. `test/saves/decide.real.ts`
 * holds the same cases against the real endpoint.
 */

const DEVICE = 'dev-1'
const T0 = '2026-10-10T04:00:00Z'
const T1 = '2026-10-10T05:00:00Z'
const T2 = '2026-10-10T06:00:00Z'

function local(
  slot: string | null,
  hash: string | null,
  updatedAt: string,
  romId = 7
): RommSyncSave {
  return {
    rom_id: romId,
    file_name: 'game.srm',
    slot,
    emulator: null,
    content_hash: hash,
    updated_at: updatedAt,
    file_size_bytes: 8192
  }
}

function sync(lastSyncedAt: string, isCurrent: boolean, isUntracked = false): RommDeviceSync {
  return {
    device_id: DEVICE,
    device_name: 'Nova',
    last_synced_at: lastSyncedAt,
    is_untracked: isUntracked,
    is_current: isCurrent
  }
}

function remote(
  id: number,
  slot: string | null,
  hash: string | null,
  updatedAt: string,
  syncs: RommDeviceSync[] = [],
  romId = 7
): RommSave {
  return {
    id,
    rom_id: romId,
    user_id: 1,
    file_name: 'game.srm',
    file_name_no_ext: 'game',
    file_extension: 'srm',
    file_size_bytes: 8192,
    download_path: '',
    emulator: null,
    slot,
    content_hash: hash,
    created_at: updatedAt,
    updated_at: updatedAt,
    device_syncs: syncs
  }
}

const actions = (decisions: { action: string; save_id: number | null }[]): string[] =>
  decisions.map((d) => `${d.action}:${d.save_id}`)

describe('compareSaveState', () => {
  const at = (client: string, server: string, synced: string | null, ch = 'a', sh = 'b') =>
    compareSaveState({
      clientHash: ch,
      clientUpdatedAt: client,
      serverHash: sh,
      serverUpdatedAt: server,
      lastSyncedAt: synced
    }).action

  test('equal hashes are in sync whatever the times', () => {
    assert.equal(at(T2, T0, T1, 'a', 'a'), 'no_op')
  })

  test('with a record, the side that moved past it wins, and both moving is a conflict', () => {
    assert.equal(at(T2, T2, T1), 'conflict')
    assert.equal(at(T2, T0, T1), 'upload')
    assert.equal(at(T0, T2, T1), 'download')
    assert.equal(at(T0, T1, T1), 'no_op')
  })

  test('with no record, the newer side wins, and a tie with different content is a conflict', () => {
    assert.equal(at(T2, T1, null), 'upload')
    assert.equal(at(T1, T2, null), 'download')
    assert.equal(at(T1, T1, null), 'conflict')
    assert.equal(at(T1, T1, null, '', ''), 'no_op')
  })

  test('a missing hash never matches, and at a tie differs from an empty one', () => {
    assert.equal(at(T1, T1, null, null as unknown as string, null as unknown as string), 'no_op')
    assert.equal(at(T1, T1, null, '', null as unknown as string), 'conflict')
    assert.equal(at(T1, T1, null, 'a', null as unknown as string), 'conflict')
  })
})

describe('decideForGame', () => {
  test('a slot the server lacks, or a save with no slot, is an upload', () => {
    const decisions = decideForGame(
      7,
      [local('autosave', 'a', T1), local(null, 'a', T1)],
      [remote(1, null, 'a', T0)],
      DEVICE
    )
    assert.deepEqual(actions(decisions), ['upload:null', 'upload:null'])
  })

  test('only the newest row of a slot pairs; older rows are history', () => {
    const decisions = decideForGame(
      7,
      [local('autosave', 'new', T1)],
      [remote(1, 'autosave', 'old', T0), remote(2, 'autosave', 'new', T2)],
      DEVICE
    )
    assert.deepEqual(actions(decisions), ['no_op:2'])
  })

  test("RomM's stand-in for a device that never synced is no record", () => {
    const decisions = decideForGame(
      7,
      [local('autosave', 'a', T1)],
      [remote(1, 'autosave', 'b', T0, [sync(T0, false)])],
      DEVICE
    )
    // With the stand-in read as a record at T0, this would still upload; the
    // reason tells the two paths apart.
    assert.equal(decisions[0]?.reason, 'Client save is newer (no sync history)')
  })

  test('a record older than the save is a record', () => {
    const decisions = decideForGame(
      7,
      [local('autosave', 'a', T0)],
      [remote(1, 'autosave', 'b', T2, [sync(T1, false)])],
      DEVICE
    )
    assert.deepEqual(decisions[0], {
      action: 'download',
      reason: 'Server save is newer than last sync',
      save_id: 1,
      slot: 'autosave'
    })
  })

  test('only this device’s record counts', () => {
    const other = { ...sync(T2, true), device_id: 'dev-2' }
    const decisions = decideForGame(
      7,
      [local('autosave', 'a', T1)],
      [remote(1, 'autosave', 'b', T0, [other])],
      DEVICE
    )
    assert.equal(decisions[0]?.reason, 'Client save is newer (no sync history)')
  })

  test('an untracked save is a no-op when the client has it, and left out when it does not', () => {
    const untracked = [sync(T0, true, true)]
    assert.deepEqual(
      actions(
        decideForGame(
          7,
          [local('autosave', 'a', T2)],
          [remote(1, 'autosave', 'b', T0, untracked)],
          DEVICE
        )
      ),
      ['no_op:1']
    )
    assert.deepEqual(decideForGame(7, [], [remote(1, 'autosave', 'b', T0, untracked)], DEVICE), [])
  })

  test('a server save the client lacks comes down, unless the device deleted it after syncing', () => {
    const decisions = decideForGame(
      7,
      [],
      [
        remote(1, 'never', 'a', T0),
        remote(2, 'deleted', 'a', T1, [sync(T1, true)]),
        remote(3, 'moved', 'a', T2, [sync(T1, false)]),
        remote(4, null, 'a', T2)
      ],
      DEVICE
    )
    assert.deepEqual(actions(decisions), ['download:1', 'download:3'])
    assert.equal(decisions[1]?.reason, 'Server save updated since last sync, not present on client')
  })

  test("another game's saves on either side play no part", () => {
    const decisions = decideForGame(
      7,
      [local('autosave', 'a', T1, 8)],
      [remote(1, 'autosave', 'b', T0, [], 8)],
      DEVICE
    )
    assert.deepEqual(decisions, [])
  })
})

describe('instant', () => {
  test('a time with no offset is UTC, as RomM reads it', () => {
    assert.equal(instant('2026-10-10T04:00:00'), instant('2026-10-10T04:00:00Z'))
    assert.equal(instant('2026-10-10T06:00:00+02:00'), instant('2026-10-10T04:00:00Z'))
  })

  test('microseconds count, as they do in Python', () => {
    assert.ok(instant('2026-10-10T04:00:00.000001Z') > instant('2026-10-10T04:00:00Z'))
    assert.equal(instant('2026-10-10T04:00:00.5Z') - instant('2026-10-10T04:00:00Z'), 500_000)
  })

  test('a time that is not one is refused rather than compared', () => {
    assert.throws(() => instant('yesterday'), /yesterday/)
  })
})
