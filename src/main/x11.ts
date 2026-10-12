import { readFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { connect, type Socket } from 'node:net'
import { join } from 'node:path'
import { log } from './log.ts'

/**
 * Just enough of the X11 protocol to read the window list: open the display,
 * intern atoms, read window properties, list a window's children and ask
 * which window holds the focus.
 *
 * In Game Mode the session is gamescope's XWayland (DEVICE-FACTS), and the
 * window list and focus live there as root-window properties. The device has
 * no `xprop` or `xdotool` to ask, and a dependency for four requests is not
 * worth its licence check, so the self-test speaks the protocol itself.
 *
 * Nothing here throws: an unreachable display opens as null, and a request
 * that fails or goes unanswered resolves null.
 */

/** How long one request waits for its answer; the display is local. */
export const REQUEST_TIMEOUT_MS = 2000

const AUTH_NAME = 'MIT-MAGIC-COOKIE-1'
const FAMILY_LOCAL = 256
const FAMILY_WILD = 65535

const OP_QUERY_TREE = 15
const OP_INTERN_ATOM = 16
const OP_GET_PROPERTY = 20
const OP_GET_INPUT_FOCUS = 43
/** AnyPropertyType: the property in whatever type it was written. */
const ANY_TYPE = 0
/** Read in 4-byte units; a window list or a pid fits many times over. */
const MAX_PROPERTY_UNITS = 65_536

export interface Property {
  type: number
  /** 8, 16 or 32: the unit `value` is in. */
  format: number
  value: Buffer
}

export interface X11 {
  root: number
  /** Null when the atom does not exist (with `onlyIfExists`) or on failure. */
  internAtom: (name: string, onlyIfExists?: boolean) => Promise<number | null>
  /** Null when the window has no such property, or on failure. */
  getProperty: (window: number, atom: number) => Promise<Property | null>
  /** The window's children, bottom to top, or null on failure. */
  queryTree: (window: number) => Promise<number[] | null>
  /** The window holding the keyboard focus (0 for none), or null on failure. */
  inputFocus: () => Promise<number | null>
  close: () => void
}

/** The unix socket of a local display, or null for one this cannot reach. */
export function displaySocket(
  display: string | undefined
): { path: string; number: string } | null {
  // Only `:N` or `:N.S`: a host before the colon means TCP, which a display
  // inside the same session never needs.
  const match = /^(?:unix)?:(\d+)(?:\.\d+)?$/.exec(display ?? '')
  if (!match) return null
  return { path: `/tmp/.X11-unix/X${match[1]}`, number: match[1] }
}

/**
 * The MIT-MAGIC-COOKIE-1 for a local display from an Xauthority file, or null
 * when it holds none (the server may then take the connection without one).
 */
export function xauthCookie(file: Buffer, host: string, displayNumber: string): Buffer | null {
  let at = 0
  const field = (): Buffer | null => {
    if (at + 2 > file.length) return null
    const length = file.readUInt16BE(at)
    if (at + 2 + length > file.length) return null
    const value = file.subarray(at + 2, at + 2 + length)
    at += 2 + length
    return value
  }
  while (at + 2 <= file.length) {
    const family = file.readUInt16BE(at)
    at += 2
    const address = field()
    const number = field()
    const name = field()
    const data = field()
    if (!address || !number || !name || !data) return null
    const local = family === FAMILY_WILD || (family === FAMILY_LOCAL && address.toString() === host)
    const display = number.length === 0 || number.toString() === displayNumber
    if (local && display && name.toString() === AUTH_NAME) return Buffer.from(data)
  }
  return null
}

const pad = (n: number): number => (4 - (n % 4)) % 4

function setupRequest(cookie: Buffer | null): Buffer {
  const name = cookie ? Buffer.from(AUTH_NAME) : Buffer.alloc(0)
  const data = cookie ?? Buffer.alloc(0)
  const out = Buffer.alloc(12 + name.length + pad(name.length) + data.length + pad(data.length))
  out.write('l', 0)
  out.writeUInt16LE(11, 2)
  out.writeUInt16LE(0, 4)
  out.writeUInt16LE(name.length, 6)
  out.writeUInt16LE(data.length, 8)
  name.copy(out, 12)
  data.copy(out, 12 + name.length + pad(name.length))
  return out
}

/** The first screen's root window from a successful setup reply. */
function rootFromSetup(reply: Buffer): number | null {
  if (reply.length < 40) return null
  const vendorLength = reply.readUInt16LE(24)
  const formats = reply.readUInt8(29)
  const screen = 40 + vendorLength + pad(vendorLength) + 8 * formats
  if (reply.readUInt8(28) < 1 || screen + 4 > reply.length) return null
  return reply.readUInt32LE(screen)
}

/**
 * Opens the display `env.DISPLAY` names, with the cookie from
 * `env.XAUTHORITY` (or `~/.Xauthority`). Null when there is no local display,
 * the server refuses, or it does not answer in time.
 */
export async function openDisplay(
  env: NodeJS.ProcessEnv,
  socketFor: (path: string) => Socket = (path) => connect(path)
): Promise<X11 | null> {
  const target = displaySocket(env.DISPLAY)
  if (!target) return null
  let cookie: Buffer | null = null
  const authFile = env.XAUTHORITY || (env.HOME ? join(env.HOME, '.Xauthority') : '')
  if (authFile) {
    try {
      cookie = xauthCookie(readFileSync(authFile), hostname(), target.number)
    } catch {
      // No file: XWayland under gamescope may take the connection without one.
    }
  }
  return openSocket(socketFor(target.path), cookie)
}

/** The protocol over an already connecting socket; see `openDisplay`. */
export function openSocket(socket: Socket, cookie: Buffer | null): Promise<X11 | null> {
  return new Promise((resolveOpen) => {
    let buffered = Buffer.alloc(0)
    let opened = false
    let closed = false
    let sequence = 0
    const pending = new Map<number, (reply: Buffer | null) => void>()

    const finish = (): void => {
      if (closed) return
      closed = true
      clearTimeout(setupTimer)
      socket.destroy()
      for (const settle of pending.values()) settle(null)
      pending.clear()
      if (!opened) resolveOpen(null)
    }
    const setupTimer = setTimeout(() => {
      log.warn('x11', 'the display did not answer the connection')
      finish()
    }, REQUEST_TIMEOUT_MS)

    const request = (body: Buffer): Promise<Buffer | null> => {
      if (closed) return Promise.resolve(null)
      sequence = (sequence + 1) & 0xffff
      const seq = sequence
      return new Promise((settle) => {
        const timer = setTimeout(() => {
          pending.delete(seq)
          settle(null)
        }, REQUEST_TIMEOUT_MS)
        pending.set(seq, (reply) => {
          clearTimeout(timer)
          pending.delete(seq)
          settle(reply)
        })
        socket.write(body)
      })
    }

    const x11 = (root: number): X11 => ({
      root,
      internAtom: async (name, onlyIfExists = false) => {
        const text = Buffer.from(name, 'latin1')
        const body = Buffer.alloc(8 + text.length + pad(text.length))
        body.writeUInt8(OP_INTERN_ATOM, 0)
        body.writeUInt8(onlyIfExists ? 1 : 0, 1)
        body.writeUInt16LE(body.length / 4, 2)
        body.writeUInt16LE(text.length, 4)
        text.copy(body, 8)
        const reply = await request(body)
        const atom = reply ? reply.readUInt32LE(8) : 0
        return atom === 0 ? null : atom
      },
      getProperty: async (window, atom) => {
        const body = Buffer.alloc(24)
        body.writeUInt8(OP_GET_PROPERTY, 0)
        body.writeUInt16LE(6, 2)
        body.writeUInt32LE(window, 4)
        body.writeUInt32LE(atom, 8)
        body.writeUInt32LE(ANY_TYPE, 12)
        body.writeUInt32LE(0, 16)
        body.writeUInt32LE(MAX_PROPERTY_UNITS, 20)
        const reply = await request(body)
        if (!reply) return null
        const type = reply.readUInt32LE(8)
        if (type === 0) return null
        const format = reply.readUInt8(1)
        const length = reply.readUInt32LE(16) * (format / 8)
        return { type, format, value: Buffer.from(reply.subarray(32, 32 + length)) }
      },
      queryTree: async (window) => {
        const body = Buffer.alloc(8)
        body.writeUInt8(OP_QUERY_TREE, 0)
        body.writeUInt16LE(2, 2)
        body.writeUInt32LE(window, 4)
        const reply = await request(body)
        if (!reply) return null
        // Never past the reply's own data, whatever the count says.
        const count = Math.min(reply.readUInt16LE(16), (reply.length - 32) / 4)
        return Array.from({ length: count }, (_, i) => reply.readUInt32LE(32 + 4 * i))
      },
      inputFocus: async () => {
        const body = Buffer.alloc(4)
        body.writeUInt8(OP_GET_INPUT_FOCUS, 0)
        body.writeUInt16LE(1, 2)
        const reply = await request(body)
        return reply ? reply.readUInt32LE(8) : null
      },
      close: finish
    })

    const drain = (): void => {
      if (!opened) {
        if (buffered.length < 8) return
        const total = 8 + 4 * buffered.readUInt16LE(6)
        if (buffered.length < total) return
        const setup = buffered.subarray(0, total)
        buffered = buffered.subarray(total)
        const root = setup.readUInt8(0) === 1 ? rootFromSetup(setup) : null
        if (root === null) {
          log.warn('x11', 'the display refused the connection', { status: setup.readUInt8(0) })
          finish()
          return
        }
        opened = true
        clearTimeout(setupTimer)
        resolveOpen(x11(root))
      }
      while (buffered.length >= 32) {
        const kind = buffered.readUInt8(0)
        // Replies and GenericEvents carry their extra length; errors and
        // other events are always 32 bytes.
        const total = kind === 1 || (kind & 0x7f) === 35 ? 32 + 4 * buffered.readUInt32LE(4) : 32
        if (buffered.length < total) return
        const message = buffered.subarray(0, total)
        buffered = buffered.subarray(total)
        if (kind > 1) continue
        // An error answers its request with nothing.
        pending.get(message.readUInt16LE(2))?.(kind === 1 ? message : null)
      }
    }

    socket.on('data', (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk])
      drain()
    })
    socket.on('error', (cause) => {
      log.warn('x11', 'the display connection failed', { cause })
      finish()
    })
    socket.on('close', finish)
    socket.on('connect', () => socket.write(setupRequest(cookie)))
  })
}
