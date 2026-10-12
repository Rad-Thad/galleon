/**
 * The parts of provision.mjs that need no server: the profiles, the
 * credentials and scopes it provisions, the few Engine.IO and cookie details
 * the scan needs, and where state is written. Kept apart so the unit tests
 * cover all of it, while provision.mjs itself is proven against Docker RomM.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/** One entry per compose profile; the ports match compose.yml. */
export const PROFILES = {
  v520: { baseUrl: 'http://127.0.0.1:18520', version: '5.2.0' },
  v531: { baseUrl: 'http://127.0.0.1:18531', version: '5.3.1' },
  v540: { baseUrl: 'http://127.0.0.1:18540', version: '5.4.0' }
}

export const ADMIN = { username: 'galleon-test', password: 'galleon-test-password' }
export const TOKEN_NAME = 'galleon-test'
export const DEVICE_NAME = 'galleon-test-device'

/**
 * What the provisioned token may do. The pairing suite checks this covers the
 * app's REQUIRED_SCOPES, so a scope the app starts needing fails setup rather
 * than surfacing as a 403 deep inside a suite.
 */
export const TOKEN_SCOPES = [
  'me.read',
  'me.write',
  'roms.read',
  'roms.user.read',
  'roms.user.write',
  'platforms.read',
  'collections.read',
  'collections.write',
  'assets.read',
  'assets.write',
  'devices.read',
  'devices.write',
  'firmware.read'
]

/** Engine.IO joins the packets of one polling response with a record separator. */
const RECORD_SEPARATOR = '\x1e'

/** Split a long-polling response body into its Engine.IO packets. */
export function splitPackets(body) {
  return body.length === 0 ? [] : body.split(RECORD_SEPARATOR)
}

/**
 * Read one Engine.IO packet. Socket.IO rides inside type 4 ("message") with
 * its own type digit; only what the scan needs is told apart.
 */
export function parsePacket(packet) {
  const type = packet[0]
  if (type === '0') return { kind: 'open', data: JSON.parse(packet.slice(1)) }
  if (type === '1') return { kind: 'close' }
  if (type === '2') return { kind: 'ping' }
  if (type === '6') return { kind: 'noop' }
  if (type === '4') {
    const inner = packet[1]
    const rest = packet.slice(2)
    if (inner === '0') return { kind: 'connect' }
    if (inner === '1') return { kind: 'disconnect' }
    if (inner === '4') return { kind: 'connect_error', data: rest ? JSON.parse(rest) : null }
    if (inner === '2') {
      const [event, ...args] = JSON.parse(rest.replace(/^\d+/, ''))
      return { kind: 'event', event, args }
    }
  }
  return { kind: 'other', packet }
}

/** A Socket.IO event, framed as the Engine.IO message the server expects. */
export function eventPacket(event, ...args) {
  return `42${JSON.stringify([event, ...args])}`
}

/** The cookies a response set, as name -> value, merged over `jar`. */
export function mergeCookies(jar, setCookies) {
  const next = { ...jar }
  for (const line of setCookies) {
    const pair = line.split(';', 1)[0]
    const at = pair.indexOf('=')
    if (at > 0) next[pair.slice(0, at).trim()] = pair.slice(at + 1).trim()
  }
  return next
}

/** A jar as one Cookie header. */
export function cookieHeader(jar) {
  return Object.entries(jar)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ')
}

export function basicAuth({ username, password }) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
}

/** Read `--name value` pairs; anything else is refused by name. */
export function parseArgs(argv) {
  const options = { profile: 'v520' }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--profile' && i + 1 < argv.length) options.profile = argv[++i]
    else throw new Error(`unknown argument: ${arg}`)
  }
  if (!Object.hasOwn(PROFILES, options.profile)) {
    throw new Error(
      `unknown profile ${options.profile}; one of ${Object.keys(PROFILES).join(', ')}`
    )
  }
  return options
}

/**
 * The profiles `npm run test:romm` runs, in order: every one by default,
 * or each `--profile` named, in the order named.
 */
export function profilesFrom(argv) {
  const named = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--profile' && i + 1 < argv.length) named.push(argv[++i])
    else throw new Error(`unknown argument: ${arg}`)
  }
  for (const profile of named) {
    if (!Object.hasOwn(PROFILES, profile)) {
      throw new Error(`unknown profile ${profile}; one of ${Object.keys(PROFILES).join(', ')}`)
    }
  }
  return named.length > 0 ? [...new Set(named)] : Object.keys(PROFILES)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Wait for the server to answer its heartbeat. `compose up -d` returns as soon
 * as the containers start, well before RomM has migrated its database.
 */
export async function waitForHeartbeat(
  baseUrl,
  { timeoutMs = 180_000, intervalMs = 1000, fetchImpl = fetch } = {}
) {
  const deadline = Date.now() + timeoutMs
  let last
  // Asked before the deadline is looked at, so the error always names a real
  // answer rather than a deadline that ran out before the first question.
  for (;;) {
    try {
      const res = await fetchImpl(`${baseUrl}/api/heartbeat`)
      if (res.ok) return res
      last = `HTTP ${res.status}`
    } catch (error) {
      last = error instanceof Error ? error.message : String(error)
    }
    if (Date.now() >= deadline) break
    await sleep(intervalMs)
  }
  throw new Error(`${baseUrl} did not answer its heartbeat in time (${last})`)
}

export function statePath(profile) {
  return join(here, '.state', `${profile}.json`)
}
