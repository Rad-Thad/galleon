#!/usr/bin/env node
/**
 * Bring a fresh Docker RomM (test/romm/compose.yml) to the state the
 * real-server suites start from: a first admin, the fixture library scanned,
 * a client token and a registered device.
 *
 *   node test/romm/provision.mjs --profile v520
 *
 * Ported from Grout's test/e2e/romm/provision.py (MIT, credited in
 * THIRD_PARTY.md). Everything goes through RomM's own API rather than its
 * database, so a change in how RomM stores things cannot quietly break the
 * suites and a change in its API breaks them loudly.
 *
 * No dependencies: the scan is only offered over socket.io, and the handful of
 * Engine.IO packets it needs are spoken here over plain HTTP long-polling
 * rather than pulling a socket.io client into the tree.
 *
 * Writes `test/romm/.state/<profile>.json` (git-ignored). Running it again
 * against the same server reuses the user, the token and the device it finds.
 * This only ever talks to the loopback servers compose starts.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  ADMIN,
  DEVICE_NAME,
  PROFILES,
  TOKEN_NAME,
  TOKEN_SCOPES,
  basicAuth,
  cookieHeader,
  eventPacket,
  mergeCookies,
  parseArgs,
  parsePacket,
  splitPackets,
  statePath,
  waitForHeartbeat
} from './lib.mjs'

/** Fail with what RomM said, not only the status: a bare 403 says nothing. */
async function check(response, what) {
  if (response.ok) return response
  const text = await response.text().catch(() => '')
  throw new Error(`${what}: ${response.status} ${text.slice(0, 500)}`)
}

/** A browser-like session: a cookie jar and the CSRF token RomM checks writes against. */
class Session {
  constructor(baseUrl) {
    this.baseUrl = baseUrl
    this.jar = {}
  }

  get csrf() {
    return this.jar.romm_csrftoken ?? ''
  }

  async fetch(path, init = {}) {
    const headers = { ...init.headers }
    if (Object.keys(this.jar).length > 0) headers.Cookie = cookieHeader(this.jar)
    if (this.csrf) headers['X-CSRFToken'] = this.csrf
    const res = await fetch(`${this.baseUrl}${path}`, { ...init, headers })
    this.jar = mergeCookies(this.jar, res.headers.getSetCookie())
    return res
  }
}

/**
 * Create the admin RomM asks for before it will do anything. Only possible
 * while the setup wizard is on offer; afterwards the endpoint wants the very
 * credentials it would be creating, which is why callers ask the heartbeat.
 */
async function createFirstUser(session) {
  await check(
    await session.fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...ADMIN,
        email: `${ADMIN.username}@example.invalid`,
        role: 'admin'
      })
    }),
    'create the first user'
  )
}

/**
 * Ask RomM to read the library into its database, as the web UI does: a scan
 * is only offered over the websocket, and the handshake is authorised by the
 * session cookie, which Basic auth alone does not give.
 */
async function scanLibrary(session, { timeoutMs = 180_000 } = {}) {
  await check(
    await session.fetch('/api/login', {
      method: 'POST',
      headers: { Authorization: basicAuth(ADMIN) }
    }),
    'sign in for the scan'
  )

  const base = '/ws/socket.io/?EIO=4&transport=polling'
  const poll = async (sid) => {
    const res = await check(await session.fetch(`${base}&sid=${sid}&t=${Date.now()}`), 'poll')
    return splitPackets(await res.text()).map(parsePacket)
  }
  const send = async (sid, packet) => {
    await check(
      await session.fetch(`${base}&sid=${sid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: packet
      }),
      'send'
    )
  }

  const opened = splitPackets(
    await (await check(await session.fetch(`${base}&t=${Date.now()}`), 'open the socket')).text()
  ).map(parsePacket)
  const open = opened.find((p) => p.kind === 'open')
  if (!open) throw new Error(`the socket did not open: ${JSON.stringify(opened)}`)
  const { sid } = open.data

  await send(sid, '40')
  let scanning = false
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const packet of await poll(sid)) {
      if (packet.kind === 'ping') await send(sid, '3')
      else if (packet.kind === 'connect_error') {
        throw new Error(`the socket refused the session: ${JSON.stringify(packet.data)}`)
      } else if (packet.kind === 'connect' && !scanning) {
        scanning = true
        // No metadata sources: the library is made up, and a scan that reached
        // a third party would make every suite depend on it being up.
        await send(sid, eventPacket('scan', { platforms: [], type: 'quick', apis: [] }))
      } else if (packet.kind === 'event' && packet.event === 'scan:done') {
        await send(sid, '41').catch(() => {})
        return
      } else if (packet.kind === 'event' && packet.event === 'scan:done_ko') {
        throw new Error(`the scan failed: ${JSON.stringify(packet.args)}`)
      } else if (packet.kind === 'close') {
        throw new Error('the server closed the socket before the scan finished')
      }
    }
  }
  throw new Error('the scan did not finish in time')
}

/**
 * Writes go with Basic auth and no cookies. Signing in to scan leaves the
 * session holding a CSRF token issued before there was a user, and RomM 5.3
 * binds the token to one; a request with no session skips the check by design.
 */
function basicFetch(baseUrl, path, init = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { Authorization: basicAuth(ADMIN), ...init.headers }
  })
}

async function tokenStillWorks(baseUrl, token) {
  if (!token) return false
  const res = await fetch(`${baseUrl}/api/users/me`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  return res.ok
}

async function mintToken(baseUrl) {
  const res = await check(
    await basicFetch(baseUrl, '/api/client-tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: TOKEN_NAME, scopes: TOKEN_SCOPES })
    }),
    'mint a client token'
  )
  return (await res.json()).raw_token
}

/** The device save sync needs, found by name before one is registered. */
async function ensureDevice(baseUrl) {
  const listed = await check(await basicFetch(baseUrl, '/api/devices'), 'list devices')
  const existing = (await listed.json()).find((device) => device.name === DEVICE_NAME)
  if (existing) return existing.id
  const res = await check(
    await basicFetch(baseUrl, '/api/devices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: DEVICE_NAME,
        platform: 'linux',
        client: 'galleon-test',
        sync_mode: 'api'
      })
    }),
    'register a device'
  )
  return (await res.json()).device_id
}

function readState(profile) {
  try {
    return JSON.parse(readFileSync(statePath(profile), 'utf8'))
  } catch {
    return null
  }
}

export async function provision(profile) {
  const { baseUrl, version } = PROFILES[profile]
  const heartbeat = await (await waitForHeartbeat(baseUrl)).json()
  const served = heartbeat?.SYSTEM?.VERSION
  if (served !== version) {
    throw new Error(`${baseUrl} serves RomM ${served}, but profile ${profile} is ${version}`)
  }

  const session = new Session(baseUrl)
  // For the CSRF cookie, which the first write needs.
  await check(await session.fetch('/api/heartbeat'), 'heartbeat')
  // RomM says whether it still wants a first user; asking beats guessing from
  // a status code, and lets a re-run against a set-up server do the right thing.
  if (heartbeat?.SYSTEM?.SHOW_SETUP_WIZARD) await createFirstUser(session)

  await scanLibrary(session)
  const platforms = await (
    await check(await basicFetch(baseUrl, '/api/platforms'), 'platforms')
  ).json()
  if (platforms.length === 0)
    throw new Error('the scan found no platforms; is the library mounted?')

  const previous = readState(profile)
  const clientToken = (await tokenStillWorks(baseUrl, previous?.clientToken))
    ? previous.clientToken
    : await mintToken(baseUrl)
  const deviceId = await ensureDevice(baseUrl)

  const state = {
    profile,
    version,
    baseUrl,
    admin: ADMIN,
    clientToken,
    deviceId,
    platforms: platforms.map((p) => p.slug).sort()
  }
  mkdirSync(dirname(statePath(profile)), { recursive: true })
  writeFileSync(statePath(profile), `${JSON.stringify(state, null, 2)}\n`)
  return state
}

if (import.meta.main) {
  const started = Date.now()
  try {
    const { profile } = parseArgs(process.argv.slice(2))
    const state = await provision(profile)
    console.log(
      `provisioned RomM ${state.version} at ${state.baseUrl}: ${state.platforms.length} platforms ` +
        `(${state.platforms.join(', ')}), device ${state.deviceId}, ` +
        `${Math.round((Date.now() - started) / 1000)}s; state in ${statePath(profile)}`
    )
  } catch (error) {
    console.error(`provision: ${error instanceof Error ? error.message : error}`)
    process.exitCode = 1
  }
}
