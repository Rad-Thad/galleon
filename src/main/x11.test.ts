import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { connect, createServer, type Server, type Socket } from 'node:net'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import { displaySocket, openDisplay, openSocket, xauthCookie } from './x11.ts'

/**
 * The X11 client against a fake display on a unix socket: the bytes it sends
 * are parsed as the protocol defines them, and the answers are built the
 * same way, so a misread offset fails here rather than on the device.
 */

const dir = mkdtempSync(join(tmpdir(), 'galleon-x11-'))
after(() => rmSync(dir, { recursive: true, force: true }))

const ROOT = 0x3a1
const COOKIE = Buffer.from('0123456789abcdef')

interface FakeDisplay {
  atoms: Map<string, number>
  /** window -> atom -> [type, format, value] */
  properties: Map<number, Map<number, [number, number, Buffer]>>
  children: Map<number, number[]>
  /** Requests answered with an X error instead of a reply. */
  failing: Set<number>
  /** Requests never answered. */
  silent: Set<number>
  cookie: Buffer | null
  /** The setup is refused whatever the cookie. */
  refuse?: boolean
  /** The setup is never answered. */
  mute?: boolean
  /** Sent ahead of every reply, as a server with events selected would. */
  noise?: Buffer[]
  seen: { cookie: Buffer | null; opcodes: number[] }
}

function fake(overrides: Partial<FakeDisplay> = {}): FakeDisplay {
  return {
    atoms: new Map([['_NET_WM_PID', 300]]),
    properties: new Map(),
    children: new Map(),
    failing: new Set(),
    silent: new Set(),
    cookie: COOKIE,
    seen: { cookie: null, opcodes: [] },
    ...overrides
  }
}

const pad = (n: number): number => (4 - (n % 4)) % 4

function setupReply(display: FakeDisplay, cookie: Buffer | null): Buffer {
  const allowed =
    !display.refuse &&
    (display.cookie === null || (cookie !== null && cookie.equals(display.cookie)))
  if (!allowed) {
    const reason = Buffer.from('No protocol specified\n')
    const out = Buffer.alloc(8 + reason.length + pad(reason.length))
    out.writeUInt8(0, 0)
    out.writeUInt8(reason.length, 1)
    out.writeUInt16LE(11, 2)
    out.writeUInt16LE((out.length - 8) / 4, 6)
    reason.copy(out, 8)
    return out
  }
  const vendor = Buffer.from('galleon fake')
  const formats = 2
  const screenAt = 40 + vendor.length + pad(vendor.length) + 8 * formats
  const out = Buffer.alloc(screenAt + 40)
  out.writeUInt8(1, 0)
  out.writeUInt16LE(11, 2)
  out.writeUInt16LE((out.length - 8) / 4, 6)
  out.writeUInt16LE(vendor.length, 24)
  out.writeUInt8(1, 28)
  out.writeUInt8(formats, 29)
  vendor.copy(out, 40)
  out.writeUInt32LE(ROOT, screenAt)
  return out
}

function reply(seq: number, extra: Buffer, fill: (head: Buffer) => void): Buffer {
  const out = Buffer.alloc(32 + extra.length + pad(extra.length))
  out.writeUInt8(1, 0)
  out.writeUInt16LE(seq, 2)
  out.writeUInt32LE((out.length - 32) / 4, 4)
  fill(out)
  extra.copy(out, 32)
  return out
}

function answer(display: FakeDisplay, seq: number, request: Buffer): Buffer | null {
  const opcode = request.readUInt8(0)
  display.seen.opcodes.push(opcode)
  if (display.silent.has(opcode)) return null
  if (display.failing.has(opcode)) {
    const out = Buffer.alloc(32)
    out.writeUInt8(0, 0)
    out.writeUInt8(3, 1)
    out.writeUInt16LE(seq, 2)
    return out
  }
  if (opcode === 16) {
    const name = request.subarray(8, 8 + request.readUInt16LE(4)).toString('latin1')
    let atom = display.atoms.get(name) ?? 0
    if (atom === 0 && request.readUInt8(1) === 0) {
      atom = 500 + display.atoms.size
      display.atoms.set(name, atom)
    }
    return reply(seq, Buffer.alloc(0), (h) => h.writeUInt32LE(atom, 8))
  }
  if (opcode === 20) {
    const found = display.properties.get(request.readUInt32LE(4))?.get(request.readUInt32LE(8))
    if (!found) return reply(seq, Buffer.alloc(0), () => {})
    const [type, format, value] = found
    return reply(seq, value, (h) => {
      h.writeUInt8(format, 1)
      h.writeUInt32LE(type, 8)
      h.writeUInt32LE(value.length / (format / 8), 16)
    })
  }
  if (opcode === 15) {
    const children = display.children.get(request.readUInt32LE(4)) ?? []
    const list = Buffer.alloc(4 * children.length)
    children.forEach((c, i) => list.writeUInt32LE(c, 4 * i))
    return reply(seq, list, (h) => {
      h.writeUInt32LE(ROOT, 8)
      h.writeUInt16LE(children.length, 16)
    })
  }
  throw new Error(`unexpected opcode ${opcode}`)
}

let counter = 0
async function serve(display: FakeDisplay): Promise<{ path: string; server: Server }> {
  const path = join(dir, `X${counter++}`)
  const server = createServer((socket: Socket) => {
    let buffered = Buffer.alloc(0)
    let setUp = false
    let seq = 0
    socket.on('error', () => {})
    socket.on('data', (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk])
      if (!setUp) {
        if (buffered.length < 12) return
        assert.equal(buffered.toString('latin1', 0, 1), 'l')
        assert.equal(buffered.readUInt16LE(2), 11)
        const nameLength = buffered.readUInt16LE(6)
        const dataLength = buffered.readUInt16LE(8)
        const dataAt = 12 + nameLength + pad(nameLength)
        const total = dataAt + dataLength + pad(dataLength)
        if (buffered.length < total) return
        const name = buffered.toString('latin1', 12, 12 + nameLength)
        const cookie = nameLength
          ? Buffer.from(buffered.subarray(dataAt, dataAt + dataLength))
          : null
        if (cookie) assert.equal(name, 'MIT-MAGIC-COOKIE-1')
        display.seen.cookie = cookie
        buffered = buffered.subarray(total)
        setUp = true
        if (display.mute) return
        // In two pieces, as a socket may deliver it.
        const setup = setupReply(display, cookie)
        socket.write(setup.subarray(0, 5))
        setTimeout(() => socket.write(setup.subarray(5)), 5)
      }
      while (buffered.length >= 4) {
        const total = 4 * buffered.readUInt16LE(2)
        if (buffered.length < total) return
        const request = buffered.subarray(0, total)
        buffered = buffered.subarray(total)
        seq = (seq + 1) & 0xffff
        const out = answer(display, seq, request)
        if (!out) continue
        for (const event of display.noise ?? []) socket.write(event)
        socket.write(out)
      }
    })
  })
  await new Promise<void>((r) => server.listen(path, r))
  return { path, server }
}

async function open(display: FakeDisplay, cookie: Buffer | null = COOKIE) {
  const { path, server } = await serve(display)
  const x11 = await openSocket(connect(path), cookie)
  return {
    x11,
    done: () => {
      x11?.close()
      server.close()
    }
  }
}

describe('displaySocket', () => {
  test('a local display is its unix socket', () => {
    assert.deepEqual(displaySocket(':1'), { path: '/tmp/.X11-unix/X1', number: '1' })
    assert.deepEqual(displaySocket(':12.0'), { path: '/tmp/.X11-unix/X12', number: '12' })
    assert.deepEqual(displaySocket('unix:0'), { path: '/tmp/.X11-unix/X0', number: '0' })
  })

  test('a remote, missing or malformed display is none', () => {
    for (const display of [undefined, '', 'host:0', 'localhost:10.0', ':x', '1']) {
      assert.equal(displaySocket(display), null, String(display))
    }
  })
})

function entry(
  family: number,
  address: string,
  number: string,
  name: string,
  data: Buffer
): Buffer {
  const fields = [Buffer.from(address), Buffer.from(number), Buffer.from(name), data]
  const head = Buffer.alloc(2)
  head.writeUInt16BE(family)
  return Buffer.concat([
    head,
    ...fields.flatMap((f) => {
      const length = Buffer.alloc(2)
      length.writeUInt16BE(f.length)
      return [length, f]
    })
  ])
}

describe('xauthCookie', () => {
  const other = Buffer.from('ffffffffffffffff')

  test('takes the entry for this host and display', () => {
    const file = Buffer.concat([
      entry(256, 'nova', '0', 'MIT-MAGIC-COOKIE-1', other),
      entry(256, 'elsewhere', '1', 'MIT-MAGIC-COOKIE-1', other),
      entry(256, 'nova', '1', 'XDM-AUTHORIZATION-1', other),
      entry(256, 'nova', '1', 'MIT-MAGIC-COOKIE-1', COOKIE)
    ])
    assert.deepEqual(xauthCookie(file, 'nova', '1'), COOKIE)
  })

  test('a wildcard family or an empty display number matches', () => {
    assert.deepEqual(
      xauthCookie(entry(65535, '', '1', 'MIT-MAGIC-COOKIE-1', COOKIE), 'nova', '1'),
      COOKIE
    )
    assert.deepEqual(
      xauthCookie(entry(256, 'nova', '', 'MIT-MAGIC-COOKIE-1', COOKIE), 'nova', '7'),
      COOKIE
    )
  })

  test('none for no match, an empty file or a truncated one', () => {
    assert.equal(
      xauthCookie(entry(256, 'nova', '0', 'MIT-MAGIC-COOKIE-1', COOKIE), 'nova', '1'),
      null
    )
    assert.equal(xauthCookie(Buffer.alloc(0), 'nova', '1'), null)
    const whole = entry(256, 'nova', '1', 'MIT-MAGIC-COOKIE-1', COOKIE)
    assert.equal(xauthCookie(whole.subarray(0, whole.length - 3), 'nova', '1'), null)
    assert.equal(xauthCookie(whole.subarray(0, 3), 'nova', '1'), null)
  })
})

describe('openSocket', () => {
  test('opens with the cookie and finds the root window', async () => {
    const display = fake()
    const { x11, done } = await open(display)
    try {
      assert.equal(x11?.root, ROOT)
      assert.deepEqual(display.seen.cookie, COOKIE)
    } finally {
      done()
    }
  })

  test('opens without a cookie where the server asks for none', async () => {
    const display = fake({ cookie: null })
    const { x11, done } = await open(display, null)
    try {
      assert.equal(x11?.root, ROOT)
      assert.equal(display.seen.cookie, null)
    } finally {
      done()
    }
  })

  test('is null when the server refuses, stays silent or is not there', async () => {
    for (const [display, cookie] of [
      [fake(), Buffer.from('wrong-cookie....')],
      [fake({ refuse: true }), COOKIE]
    ] as const) {
      const { x11, done } = await open(display, cookie)
      assert.equal(x11, null)
      done()
    }
    assert.equal(await openSocket(connect(join(dir, 'nothing-here')), COOKIE), null)
  })

  test('is null when the setup goes unanswered', async (t) => {
    const display = fake({ mute: true })
    const { path, server } = await serve(display)
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const opening = openSocket(connect(path), COOKIE)
    // The connection is real; only the wait for its answer is the clock's.
    while (display.seen.cookie === null) await new Promise((r) => setImmediate(r))
    t.mock.timers.runAll()
    assert.equal(await opening, null)
    t.mock.timers.reset()
    server.close()
  })

  test('interns atoms, existing or not', async () => {
    const display = fake()
    const { x11, done } = await open(display)
    try {
      assert.equal(await x11?.internAtom('_NET_WM_PID', true), 300)
      assert.equal(await x11?.internAtom('GAMESCOPE_FOCUSED_WINDOW', true), null)
      const made = await x11?.internAtom('GAMESCOPE_FOCUSED_WINDOW')
      assert.equal(made, display.atoms.get('GAMESCOPE_FOCUSED_WINDOW'))
      assert.equal(await x11?.internAtom('GAMESCOPE_FOCUSED_WINDOW', true), made)
    } finally {
      done()
    }
  })

  test('reads a property in its own format, and none where it is missing', async () => {
    const list = Buffer.alloc(12)
    ;[0x400001, 0x400002, 0x600001].forEach((w, i) => list.writeUInt32LE(w, 4 * i))
    const display = fake({
      properties: new Map([
        [
          ROOT,
          new Map([
            [600, [33, 32, list] as [number, number, Buffer]],
            [601, [31, 8, Buffer.from('gamescope')] as [number, number, Buffer]]
          ])
        ]
      ])
    })
    const { x11, done } = await open(display)
    try {
      assert.deepEqual(await x11?.getProperty(ROOT, 600), { type: 33, format: 32, value: list })
      assert.deepEqual(await x11?.getProperty(ROOT, 601), {
        type: 31,
        format: 8,
        value: Buffer.from('gamescope')
      })
      assert.equal(await x11?.getProperty(ROOT, 602), null)
      assert.equal(await x11?.getProperty(0x400001, 600), null)
    } finally {
      done()
    }
  })

  test('lists children, and none for a window without', async () => {
    const display = fake({ children: new Map([[ROOT, [0x400001, 0x600001]]]) })
    const { x11, done } = await open(display)
    try {
      assert.deepEqual(await x11?.queryTree(ROOT), [0x400001, 0x600001])
      assert.deepEqual(await x11?.queryTree(0x400001), [])
    } finally {
      done()
    }
  })

  test('an X error answers its request with null and the next still works', async () => {
    const display = fake({ failing: new Set([20, 15]) })
    const { x11, done } = await open(display)
    try {
      assert.equal(await x11?.getProperty(0xdead, 600), null)
      assert.equal(await x11?.queryTree(0xdead), null)
      assert.equal(await x11?.internAtom('_NET_WM_PID', true), 300)
    } finally {
      done()
    }
  })

  test('events between replies are passed over', async () => {
    const event = Buffer.alloc(32)
    event.writeUInt8(28, 0)
    const generic = Buffer.alloc(40)
    generic.writeUInt8(35, 0)
    generic.writeUInt32LE(2, 4)
    const display = fake({ noise: [event, generic] })
    const { x11, done } = await open(display)
    try {
      assert.equal(await x11?.internAtom('_NET_WM_PID', true), 300)
      assert.deepEqual(await x11?.queryTree(ROOT), [])
    } finally {
      done()
    }
  })

  test('an unanswered request resolves null after the timeout', async (t) => {
    const display = fake({ silent: new Set([20]) })
    const { x11, done } = await open(display)
    try {
      t.mock.timers.enable({ apis: ['setTimeout'] })
      const reading = x11?.getProperty(ROOT, 600)
      t.mock.timers.runAll()
      assert.equal(await reading, null)
      t.mock.timers.reset()
      assert.equal(await x11?.internAtom('_NET_WM_PID', true), 300)
    } finally {
      done()
    }
  })

  test('after close every request is null', async () => {
    const { x11, done } = await open(fake())
    x11?.close()
    try {
      assert.equal(await x11?.internAtom('_NET_WM_PID', true), null)
      assert.equal(await x11?.getProperty(ROOT, 600), null)
    } finally {
      done()
    }
  })

  test('a request in flight when the server goes away is null', async () => {
    const display = fake({ silent: new Set([15]) })
    const { path, server } = await serve(display)
    let socket: Socket | null = null
    server.on('connection', (s) => (socket = s))
    const x11 = await openSocket(connect(path), COOKIE)
    const listing = x11?.queryTree(ROOT)
    await new Promise((r) => setTimeout(r, 20))
    ;(socket as Socket | null)?.destroy()
    assert.equal(await listing, null)
    server.close()
  })
})

describe('openDisplay', () => {
  test('reads the cookie from XAUTHORITY and connects to the display', async () => {
    const display = fake()
    const { path, server } = await serve(display)
    const authFile = join(dir, 'Xauthority')
    writeFileSync(authFile, entry(256, hostname(), '1', 'MIT-MAGIC-COOKIE-1', COOKIE))
    const asked: string[] = []
    const x11 = await openDisplay({ DISPLAY: ':1', XAUTHORITY: authFile }, (socketPath) => {
      asked.push(socketPath)
      return connect(path)
    })
    try {
      assert.deepEqual(asked, ['/tmp/.X11-unix/X1'])
      assert.equal(x11?.root, ROOT)
      assert.deepEqual(display.seen.cookie, COOKIE)
    } finally {
      x11?.close()
      server.close()
    }
  })

  test('falls back to ~/.Xauthority, and to no cookie without one', async () => {
    const home = mkdtempSync(join(dir, 'home-'))
    writeFileSync(join(home, '.Xauthority'), entry(65535, '', '', 'MIT-MAGIC-COOKIE-1', COOKIE))
    for (const [env, expected] of [
      [{ DISPLAY: ':0', HOME: home }, COOKIE],
      [{ DISPLAY: ':0', HOME: join(home, 'missing') }, null],
      [{ DISPLAY: ':0' }, null]
    ] as const) {
      const display = fake({ cookie: null })
      const { path, server } = await serve(display)
      const x11 = await openDisplay(env, () => connect(path))
      assert.equal(x11?.root, ROOT)
      assert.deepEqual(display.seen.cookie, expected)
      x11?.close()
      server.close()
    }
  })

  test('is null without a local display, and connects to nothing', async () => {
    let asked = false
    const connectTo = () => {
      asked = true
      return connect(join(dir, 'never'))
    }
    assert.equal(await openDisplay({}, connectTo), null)
    assert.equal(await openDisplay({ DISPLAY: 'remote:0' }, connectTo), null)
    assert.equal(asked, false)
  })
})
