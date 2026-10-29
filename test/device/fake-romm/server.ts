/**
 * The fake RomM the device bundle runs for save checks (M2-20).
 *
 * Only on 127.0.0.1 and on a port the system picks, so nothing on the Nova's
 * network can reach it and no two runs meet. It answers the calls the save
 * engine makes, with RomM 5.2.0's behaviour from `saves.ts` and `sync.ts`;
 * anything else is a 404, so a call the engine starts making shows up as a
 * failure here before it shows up on the owner's server.
 */
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { localContentHash } from '../../../src/main/savehash.ts'
import { SaveStore, type ClientSave } from './saves.ts'
import { SyncSessions, type Completion } from './sync.ts'

export const VERSION = '5.2.0'
const USER_ID = 1

export interface FakeRommOptions {
  /** The bearer token every call but the heartbeat must carry. */
  token: string
  /** The ROM ids the server has; a save for any other is a 404, as on RomM. */
  romIds: readonly number[]
  /** Where an upload is put down while it is hashed, and removed from at once. */
  scratch: string
}

export interface FakeRomm {
  baseUrl: string
  close(): Promise<void>
}

interface Device {
  id: string
  name: string | null
  platform: string | null
  mac_address: string | null
  hostname: string | null
  client_device_identifier: string | null
  created_at: string
}

interface Registration {
  name?: string | null
  platform?: string | null
  mac_address?: string | null
  hostname?: string | null
  client_device_identifier?: string | null
  allow_existing?: boolean
  allow_duplicate?: boolean
}

/**
 * The device a registration names, as RomM 5.2.0's registration finds it: by
 * MAC address alone when there is one, else by hostname and platform. This
 * is what hands the app, which registers with `allow_existing`, its own
 * device back rather than a second one.
 */
function sameMachine(devices: readonly Device[], asked: Registration): Device | undefined {
  const { mac_address: mac, hostname: host, platform } = asked
  if (mac) {
    const found = devices.find((device) => device.mac_address === mac)
    if (found) return found
  }
  if (host && platform) {
    return devices.find((device) => device.hostname === host && device.platform === platform)
  }
  return undefined
}

function body(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function json(res: ServerResponse, value: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(value))
}

/**
 * RomM's `content_hash`, by the app's own reader: `hash.real.ts` holds that to
 * what RomM 5.2.0 stores on every edge case, so a second reader here could only
 * be the one that disagrees.
 */
async function hashOf(bytes: Buffer, scratch: string): Promise<string | null> {
  const dir = mkdtempSync(join(scratch, 'fake-romm-'))
  try {
    const path = join(dir, 'upload')
    writeFileSync(path, bytes)
    return await localContentHash(path)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** The multipart upload's one file, parsed the way `fetch` built it. */
async function uploaded(
  req: IncomingMessage,
  bytes: Buffer
): Promise<{ name: string; bytes: Buffer } | null> {
  const type = req.headers['content-type']
  if (!type?.startsWith('multipart/form-data')) return null
  const form = await new Response(bytes, { headers: { 'Content-Type': type } }).formData()
  const file = form.get('saveFile')
  if (!file || typeof file === 'string') return null
  return { name: file.name, bytes: Buffer.from(await file.arrayBuffer()) }
}

export async function startFakeRomm(options: FakeRommOptions): Promise<FakeRomm> {
  const saves = new SaveStore(USER_ID)
  const devices: Device[] = []
  const roms = new Set(options.romIds)
  const sessions = new SyncSessions(USER_ID, roms)

  async function answer(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://fake')
    const path = url.pathname
    const query = url.searchParams
    const sent = await body(req)

    if (path === '/api/heartbeat') return json(res, { SYSTEM: { VERSION } })
    if (req.headers.authorization !== `Bearer ${options.token}`) {
      return json(res, { detail: 'Not authenticated' }, 401)
    }

    if (path === '/api/devices' && req.method === 'GET') return json(res, devices)
    if (path === '/api/devices' && req.method === 'POST') {
      const asked = JSON.parse(sent.toString() || '{}') as Registration
      const existing = asked.allow_duplicate ? undefined : sameMachine(devices, asked)
      if (existing && asked.allow_existing === false) {
        return json(
          res,
          {
            detail: {
              error: 'device_exists',
              message: 'A device with this fingerprint already exists',
              device_id: existing.id
            }
          },
          409
        )
      }
      if (existing) {
        return json(res, {
          device_id: existing.id,
          name: existing.name,
          created_at: existing.created_at
        })
      }
      const device: Device = {
        id: randomUUID(),
        name: asked.name ?? null,
        platform: asked.platform ?? null,
        mac_address: asked.mac_address ?? null,
        hostname: asked.hostname ?? null,
        client_device_identifier: asked.client_device_identifier ?? null,
        created_at: new Date().toISOString()
      }
      devices.push(device)
      return json(
        res,
        { device_id: device.id, name: device.name, created_at: device.created_at },
        201
      )
    }

    const deviceId = query.get('device_id')
    if (deviceId && !devices.some((device) => device.id === deviceId)) {
      return json(res, { detail: 'Device not found' }, 404)
    }

    if (path === '/api/saves' && req.method === 'POST') {
      const romId = Number(query.get('rom_id'))
      if (!roms.has(romId)) return json(res, { detail: 'Rom not found' }, 404)
      const file = await uploaded(req, sent)
      if (!file) return json(res, { detail: 'No save file' }, 400)
      const result = saves.upload({
        romId,
        fileName: file.name,
        bytes: file.bytes,
        hash: await hashOf(file.bytes, options.scratch),
        emulator: query.get('emulator'),
        slot: query.get('slot'),
        deviceId,
        overwrite: query.get('overwrite') === 'true'
      })
      return result.status === 200
        ? json(res, result.save)
        : json(res, { detail: result.detail }, result.status)
    }
    if (path === '/api/saves' && req.method === 'GET') {
      return json(res, saves.list(Number(query.get('rom_id')), deviceId))
    }
    if (path === '/api/saves/delete' && req.method === 'POST') {
      const { saves: ids = [] } = JSON.parse(sent.toString() || '{}') as { saves?: number[] }
      return json(res, saves.delete(ids))
    }

    if (path === '/api/sync/negotiate' && req.method === 'POST') {
      const asked = JSON.parse(sent.toString() || '{}') as {
        device_id?: string | null
        saves?: ClientSave[]
      }
      if (!asked.device_id) return json(res, { detail: 'device_id is required' }, 400)
      const holder = asked.device_id
      if (!devices.some((device) => device.id === holder)) {
        return json(res, { detail: `Device with ID ${holder} not found` }, 404)
      }
      const operations = saves.negotiate(holder, asked.saves ?? [])
      const total = (action: string): number =>
        operations.filter((op) => op.action === action).length
      return json(res, {
        session_id: sessions.open(holder, operations.length - total('no_op')),
        operations,
        total_upload: total('upload'),
        total_download: total('download'),
        total_conflict: total('conflict'),
        total_no_op: total('no_op')
      })
    }
    const complete = /^\/api\/sync\/sessions\/(\d+)\/complete$/.exec(path)
    if (complete && req.method === 'POST') {
      const result = sessions.complete(
        Number(complete[1]),
        JSON.parse(sent.toString() || '{}') as Completion
      )
      return result.status === 200
        ? json(res, result.body)
        : json(res, { detail: result.detail }, result.status)
    }

    const content = /^\/api\/saves\/(\d+)\/content(?:\/[^/]*)?$/.exec(path)
    if (content && req.method === 'GET') {
      const bytes = saves.content(Number(content[1]), deviceId, query.get('optimistic') !== 'false')
      if (!bytes) return json(res, { detail: 'Save not found' }, 404)
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': bytes.length
      })
      res.end(bytes)
      return
    }
    const downloaded = /^\/api\/saves\/(\d+)\/downloaded$/.exec(path)
    if (downloaded && req.method === 'POST') {
      const { device_id: holder } = JSON.parse(sent.toString() || '{}') as { device_id?: string }
      if (!holder || !devices.some((device) => device.id === holder)) {
        return json(res, { detail: 'Device not found' }, 404)
      }
      const save = saves.downloaded(Number(downloaded[1]), holder)
      return save ? json(res, save) : json(res, { detail: 'Save not found' }, 404)
    }

    return json(res, { detail: 'Not Found' }, 404)
  }

  const server = createServer((req, res) => {
    answer(req, res).catch((cause: unknown) => {
      json(res, { detail: (cause as Error).message }, 500)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
  }
}
