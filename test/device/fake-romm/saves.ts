/**
 * RomM 5.2.0's saves, as the fake server on the device keeps them (M2-20).
 *
 * The save engine has to upload and download for real on the Nova, and the
 * owner's server may only be read (CLAUDE.md rail 1), so the bundle carries a
 * server of its own. What it holds is the behaviour docs/save-sync/SPEC.md
 * records for the calls the engine makes (sections 3, 4, 6 and 7), not the
 * shortcuts `test/app/server.ts` takes to answer the interface: a slot is a
 * history of stamped copies and a device's record decides a 409.
 * `test/saves/contract.ts` holds this file and Docker RomM 5.2.0 to the same
 * answers. The hash arrives with the upload: see `startFakeRomm`.
 */
/** A save row, in the fields of `SaveSchema` the engine reads. */
export interface Save {
  id: number
  rom_id: number
  user_id: number
  file_name: string
  file_name_no_ext: string
  file_extension: string
  file_size_bytes: number
  download_path: string
  emulator: string | null
  slot: string | null
  content_hash: string | null
  origin_device_id: string | null
  created_at: string
  updated_at: string
}

/** `DeviceSyncSchema`: one device's record of a save. */
export interface DeviceSync {
  device_id: string
  device_name: string | null
  last_synced_at: string
  is_untracked: boolean
  is_current: boolean
}

export interface Upload {
  romId: number
  fileName: string
  bytes: Buffer
  /** RomM's `content_hash` of `bytes` (SPEC.md section 4). */
  hash: string | null
  emulator: string | null
  slot: string | null
  deviceId: string | null
  overwrite: boolean
}

/** One save as a client reports it to negotiate (`ClientSaveState`). */
export interface ClientSave {
  rom_id: number
  file_name: string
  slot: string | null
  emulator: string | null
  content_hash: string | null
  updated_at: string
  file_size_bytes: number
}

export type SyncAction = 'upload' | 'download' | 'conflict' | 'no_op'

/** One decision of a negotiate (`SyncOperationSchema`). */
export interface SyncOperation {
  action: SyncAction
  rom_id: number
  save_id: number | null
  file_name: string
  slot: string | null
  emulator: string | null
  reason: string
  server_updated_at: string | null
  server_content_hash: string | null
}

/**
 * Microseconds since the epoch, as RomM compares times. A client's
 * `updated_at` may carry more digits than `Date` keeps, and a time with no
 * offset is UTC there. Not the engine's `instant`: that one's module needs
 * Electron, and the fake runs under plain Node.
 */
function micros(iso: string): number {
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(iso) ? iso : `${iso}Z`
  const fraction = /T[\d:]+\.(\d+)/.exec(iso)?.[1] ?? ''
  return Date.parse(zoned) * 1000 + Number(fraction.slice(3, 6).padEnd(3, '0'))
}

/**
 * RomM's `compare_save_state`: equal hashes first, then which side moved
 * since the device's record, and with no record the newer side.
 */
function compare(client: ClientSave, server: Save, synced: string | undefined): SyncAction {
  if (client.content_hash && server.content_hash && client.content_hash === server.content_hash) {
    return 'no_op'
  }
  const clientAt = micros(client.updated_at)
  const serverAt = micros(server.updated_at)
  if (synced !== undefined) {
    const clientMoved = clientAt > micros(synced)
    const serverMoved = serverAt > micros(synced)
    if (clientMoved && serverMoved) return 'conflict'
    if (clientMoved) return 'upload'
    return serverMoved ? 'download' : 'no_op'
  }
  if (clientAt !== serverAt) return clientAt > serverAt ? 'upload' : 'download'
  return client.content_hash === server.content_hash ? 'no_op' : 'conflict'
}

/** What an upload came to: the row RomM answers with, or its refusal. */
export type UploadResult = { status: 200; save: Save } | { status: 409; detail: string }

/** The UTC tag RomM puts before the extension of a slotted upload. */
function stamped(fileName: string, at: Date): string {
  const tag = at.toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-')
  const dot = fileName.lastIndexOf('.')
  return dot > 0
    ? `${fileName.slice(0, dot)} [${tag}]${fileName.slice(dot)}`
    : `${fileName} [${tag}]`
}

function split(fileName: string): { stem: string; extension: string } {
  const dot = fileName.lastIndexOf('.')
  return dot > 0
    ? { stem: fileName.slice(0, dot), extension: fileName.slice(dot + 1) }
    : { stem: fileName, extension: '' }
}

export class SaveStore {
  private readonly rows = new Map<number, { save: Save; bytes: Buffer }>()
  /** Save id → device id → the `updated_at` that device last held. */
  private readonly syncs = new Map<number, Map<string, string>>()
  private nextId = 1
  private readonly userId: number
  private readonly now: () => Date

  constructor(userId: number, now: () => Date = () => new Date()) {
    this.userId = userId
    this.now = now
  }

  /**
   * `POST /api/saves`, after the server has found the ROM.
   *
   * The refusal comes before anything is written, and `overwrite` skips it
   * and the same-hash shortcut alike (SPEC.md sections 3 and 7).
   */
  upload(upload: Upload): UploadResult {
    const { romId, slot, deviceId, overwrite, hash } = upload
    const named = slot
      ? undefined
      : this.ofRom(romId).find(
          (row) => row.save.slot === null && row.save.file_name === upload.fileName
        )

    if (deviceId && !overwrite) {
      if (slot) {
        const newest = this.newest(romId, slot)
        if (newest && !this.holds(newest.save, deviceId)) return conflict()
      } else if (
        named &&
        this.recorded(named.save.id, deviceId) &&
        !this.holds(named.save, deviceId)
      ) {
        return conflict()
      }
    }

    if (slot && !overwrite && hash) {
      const same = this.ofRom(romId).find(
        (row) => row.save.slot === slot && row.save.content_hash === hash
      )
      if (same) return { status: 200, save: same.save }
    }

    const at = this.now().toISOString()
    if (named) {
      Object.assign(named.save, {
        file_size_bytes: upload.bytes.length,
        content_hash: hash,
        emulator: upload.emulator,
        updated_at: at
      })
      named.bytes = upload.bytes
      if (deviceId) this.record(named.save, deviceId)
      return { status: 200, save: named.save }
    }

    const fileName = slot ? stamped(upload.fileName, this.now()) : upload.fileName
    const { stem, extension } = split(fileName)
    const id = this.nextId++
    const save: Save = {
      id,
      rom_id: romId,
      user_id: this.userId,
      file_name: fileName,
      file_name_no_ext: stem,
      file_extension: extension,
      file_size_bytes: upload.bytes.length,
      download_path: `/api/saves/${id}/content/${encodeURIComponent(fileName)}`,
      emulator: upload.emulator,
      slot,
      content_hash: hash,
      origin_device_id: deviceId,
      created_at: at,
      updated_at: at
    }
    this.rows.set(save.id, { save, bytes: upload.bytes })
    if (deviceId) this.record(save, deviceId)
    return { status: 200, save }
  }

  /**
   * `GET /api/saves?rom_id`: naming a device only reads, filling in its
   * record of each save, a stand-in one when it has none.
   */
  list(romId: number, deviceId: string | null = null): (Save & { device_syncs?: DeviceSync[] })[] {
    return this.ofRom(romId).map(({ save }) => {
      if (!deviceId) return { ...save }
      const held = this.syncs.get(save.id)?.get(deviceId)
      return {
        ...save,
        device_syncs: [
          {
            device_id: deviceId,
            device_name: null,
            last_synced_at: held ?? save.updated_at,
            is_untracked: false,
            is_current: held !== undefined && held >= save.updated_at
          }
        ]
      }
    })
  }

  /**
   * `GET /api/saves/{id}/content`. Optimistic unless told otherwise, as on the
   * server: the read itself then records the device as holding it.
   */
  content(id: number, deviceId: string | null, optimistic: boolean): Buffer | null {
    const row = this.rows.get(id)
    if (!row) return null
    if (deviceId && optimistic) this.record(row.save, deviceId)
    return row.bytes
  }

  /** `POST /api/saves/{id}/downloaded`. */
  downloaded(id: number, deviceId: string): Save | null {
    const row = this.rows.get(id)
    if (!row) return null
    this.record(row.save, deviceId)
    return row.save
  }

  /**
   * `POST /api/sync/negotiate`'s decisions, as RomM 5.2.0 makes them
   * (docs/save-sync/SPEC.md section 5).
   *
   * Paired on game and slot against the newest save of each slot, across the
   * whole library: 5.2.0 reads no `rom_ids`, so a device is offered every
   * slotted save it has not held whatever game it asked about. A save under no
   * slot never pairs. The order is RomM's: the client's saves as sent, then
   * the server's it did not mention.
   */
  negotiate(deviceId: string, client: readonly ClientSave[]): SyncOperation[] {
    const newest = new Map<string, Save>()
    for (const { save } of this.rows.values()) {
      if (save.slot === null) continue
      const key = `${save.rom_id}\u0000${save.slot}`
      const held = newest.get(key)
      if (!held || micros(save.updated_at) > micros(held.updated_at)) newest.set(key, save)
    }
    const fromServer = (save: Save, action: SyncAction, reason: string): SyncOperation => ({
      action,
      rom_id: save.rom_id,
      save_id: save.id,
      file_name: save.file_name,
      slot: save.slot,
      emulator: save.emulator,
      reason,
      server_updated_at: save.updated_at,
      server_content_hash: save.content_hash
    })

    const mentioned = new Set<number>()
    const operations = client.map((local): SyncOperation => {
      const save =
        local.slot === null ? undefined : newest.get(`${local.rom_id}\u0000${local.slot}`)
      if (!save) {
        return {
          action: 'upload',
          rom_id: local.rom_id,
          save_id: null,
          file_name: local.file_name,
          slot: local.slot,
          emulator: local.emulator,
          reason: 'no save on the server in this slot',
          server_updated_at: null,
          server_content_hash: null
        }
      }
      mentioned.add(save.id)
      const action = compare(local, save, this.syncs.get(save.id)?.get(deviceId))
      return fromServer(save, action, `compared: ${action}`)
    })
    for (const save of newest.values()) {
      if (mentioned.has(save.id)) continue
      const synced = this.syncs.get(save.id)?.get(deviceId)
      if (synced !== undefined && micros(save.updated_at) <= micros(synced)) continue
      operations.push(fromServer(save, 'download', 'not held by this device'))
    }
    return operations
  }

  /** `POST /api/saves/delete`: the ids that were there. */
  delete(ids: readonly number[]): number[] {
    const gone = ids.filter((id) => this.rows.has(id))
    for (const id of gone) {
      this.rows.delete(id)
      this.syncs.delete(id)
    }
    return gone
  }

  private ofRom(romId: number): { save: Save; bytes: Buffer }[] {
    return [...this.rows.values()].filter((row) => row.save.rom_id === romId)
  }

  private newest(romId: number, slot: string): { save: Save; bytes: Buffer } | undefined {
    return this.ofRom(romId)
      .filter((row) => row.save.slot === slot)
      .sort(
        (a, b) => b.save.updated_at.localeCompare(a.save.updated_at) || b.save.id - a.save.id
      )[0]
  }

  private record(save: Save, deviceId: string): void {
    const held = this.syncs.get(save.id) ?? new Map<string, string>()
    held.set(deviceId, save.updated_at)
    this.syncs.set(save.id, held)
  }

  private recorded(id: number, deviceId: string): boolean {
    return this.syncs.get(id)?.has(deviceId) === true
  }

  private holds(save: Save, deviceId: string): boolean {
    const held = this.syncs.get(save.id)?.get(deviceId)
    return held !== undefined && held >= save.updated_at
  }
}

function conflict(): UploadResult {
  return { status: 409, detail: 'Save conflict: this device does not hold the newest save' }
}
