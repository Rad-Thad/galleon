import type { RommSave, RommSyncOperation, RommSyncSave } from '@shared/types'
import { t } from './i18n.ts'

/**
 * RomM's negotiate decision for one game, reached from a read.
 *
 * `POST /api/sync/negotiate` is a write: it opens a session, and before RomM
 * 5.4 cancels the device's others. `GET /api/saves?rom_id&device_id` is not,
 * and it returns every fact negotiate decides on, so the same decision can be
 * taken here with nothing recorded on the server. That is allowed only while
 * a test shows this file and the real endpoint agree
 * (`test/saves/decide.real.ts`), which is why the code follows RomM's
 * `endpoints/sync.py` and `handler/sync/comparison.py` step for step rather
 * than restating them. The two are the same on 5.2.0, 5.3.1 and 5.4.0;
 * docs/save-sync/SPEC.md section 5 has the rules in words.
 */

export type Decision = Pick<RommSyncOperation, 'action' | 'save_id' | 'slot' | 'reason'>

/**
 * What negotiate would answer for `romId`, given the device's saves for it
 * and that game's saves as listed for `deviceId` (`RommClient.savesForDevice`).
 *
 * Client saves come first, in the order given, then the server saves the
 * client did not mention: negotiate's own order.
 */
export function decideForGame(
  romId: number,
  local: readonly RommSyncSave[],
  server: readonly RommSave[],
  deviceId: string
): Decision[] {
  // Negotiate pairs on (rom_id, slot) against the newest row of each slot;
  // older rows of a slot are history, and null-slot rows never pair.
  const newest = new Map<string, RommSave>()
  for (const save of server) {
    if (save.rom_id !== romId || save.slot === null) continue
    const current = newest.get(save.slot)
    if (!current || instant(save.updated_at) > instant(current.updated_at)) {
      newest.set(save.slot, save)
    }
  }

  const decisions: Decision[] = []
  const matched = new Set<number>()
  for (const client of local) {
    if (client.rom_id !== romId) continue
    const save = client.slot === null ? undefined : newest.get(client.slot)
    if (!save) {
      decisions.push({
        action: 'upload',
        save_id: null,
        slot: client.slot,
        reason: 'Save exists on client but not on server'
      })
      continue
    }
    matched.add(save.id)
    const record = recordOf(save, deviceId)
    if (record?.untracked) {
      decisions.push({
        action: 'no_op',
        save_id: save.id,
        slot: save.slot,
        reason: 'Save is untracked on this device'
      })
      continue
    }
    decisions.push({
      ...compareSaveState({
        clientHash: client.content_hash,
        clientUpdatedAt: client.updated_at,
        serverHash: save.content_hash,
        serverUpdatedAt: save.updated_at,
        lastSyncedAt: record?.lastSyncedAt ?? null
      }),
      save_id: save.id,
      slot: save.slot
    })
  }

  for (const save of newest.values()) {
    if (matched.has(save.id)) continue
    const record = recordOf(save, deviceId)
    if (record?.untracked) continue
    if (record) {
      // Synced before and unchanged since: the device deleted it on purpose.
      if (instant(save.updated_at) <= instant(record.lastSyncedAt)) continue
      decisions.push({
        action: 'download',
        save_id: save.id,
        slot: save.slot,
        reason: 'Server save updated since last sync, not present on client'
      })
    } else {
      decisions.push({
        action: 'download',
        save_id: save.id,
        slot: save.slot,
        reason: 'Save exists on server but not on client'
      })
    }
  }
  return decisions
}

/**
 * RomM's `compare_save_state`, every comparison strict as it is there.
 *
 * A hash counts only when it is non-empty, as Python's truthiness has it, but
 * at equal times any difference counts, an empty hash against a missing one
 * included.
 */
export function compareSaveState(input: {
  clientHash: string | null
  clientUpdatedAt: string
  serverHash: string | null
  serverUpdatedAt: string
  lastSyncedAt: string | null
}): Pick<Decision, 'action' | 'reason'> {
  const clientHash = input.clientHash ?? null
  const serverHash = input.serverHash ?? null
  if (clientHash && serverHash && clientHash === serverHash) {
    return { action: 'no_op', reason: 'Content is identical' }
  }
  const client = instant(input.clientUpdatedAt)
  const server = instant(input.serverUpdatedAt)
  if (input.lastSyncedAt) {
    const synced = instant(input.lastSyncedAt)
    const clientChanged = client > synced
    const serverChanged = server > synced
    if (clientChanged && serverChanged) {
      return { action: 'conflict', reason: 'Both sides changed since last sync' }
    }
    if (clientChanged) return { action: 'upload', reason: 'Client save is newer than last sync' }
    if (serverChanged) return { action: 'download', reason: 'Server save is newer than last sync' }
    return { action: 'no_op', reason: 'No changes since last sync' }
  }
  if (client > server) return { action: 'upload', reason: 'Client save is newer (no sync history)' }
  if (server > client) {
    return { action: 'download', reason: 'Server save is newer (no sync history)' }
  }
  if (clientHash !== serverHash) {
    return { action: 'conflict', reason: 'Same timestamp but different content' }
  }
  return { action: 'no_op', reason: 'Saves appear identical' }
}

interface SyncRecord {
  lastSyncedAt: string
  untracked: boolean
}

/**
 * This device's record of `save`, or undefined when it has none.
 *
 * RomM lists a stand-in for a device that never synced the save: not
 * current, and stamped with the save's own `updated_at`. A real record at
 * that instant is current, so the stand-in is the only entry that is neither.
 */
function recordOf(save: RommSave, deviceId: string): SyncRecord | undefined {
  const entry = save.device_syncs?.find((sync) => sync.device_id === deviceId)
  if (!entry) return undefined
  if (!entry.is_current && instant(entry.last_synced_at) === instant(save.updated_at)) {
    return undefined
  }
  return { lastSyncedAt: entry.last_synced_at, untracked: entry.is_untracked }
}

/**
 * Microseconds since the epoch, as RomM's `to_utc` compares them.
 *
 * A time with no offset is UTC there, and Python keeps microseconds where
 * `Date` keeps milliseconds, so the digits past the third are added back.
 */
export function instant(iso: string): number {
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(iso) ? iso : `${iso}Z`
  const ms = Date.parse(zoned)
  if (Number.isNaN(ms)) throw new Error(t('error.saveBadTime', { value: iso }))
  const fraction = /T[\d:]+\.(\d+)/.exec(iso)?.[1] ?? ''
  const micros = Number(fraction.slice(3, 6).padEnd(3, '0'))
  return ms * 1000 + micros
}
