import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CoreSocketInUseError, startCoreSocket, type CoreHandler } from './server.ts'
import { MAX_LINE_BYTES } from './protocol.ts'

/**
 * Driven over a real Unix socket, since the file's mode, its removal and the
 * way lines arrive in pieces are all properties of the socket, not the code.
 */
let root: string | null = null
const closers: Array<() => Promise<void>> = []

afterEach(async () => {
  while (closers.length) await closers.pop()!()
  if (root) rmSync(root, { recursive: true, force: true })
  root = null
})

function folder(): string {
  root = mkdtempSync(join(tmpdir(), 'coresocket-'))
  return join(root, 'galleon')
}

const echoStatus: CoreHandler = (request) => ({ ok: true, result: { cmd: request.cmd } })

async function start(handle: CoreHandler = echoStatus) {
  const socket = await startCoreSocket(folder(), handle)
  closers.push(socket.close)
  return socket
}

/** Send `chunks` in order and collect `count` answer lines. */
function exchange(path: string, chunks: string[], count: number): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const client = createConnection(path)
    let text = ''
    client.setEncoding('utf8')
    client.on('connect', async () => {
      for (const chunk of chunks) {
        client.write(chunk)
        await new Promise((r) => setTimeout(r, 5))
      }
    })
    client.on('data', (data: string) => {
      text += data
      const lines = text.split('\n').filter(Boolean)
      if (lines.length >= count) {
        client.destroy()
        resolve(lines.map((line) => JSON.parse(line)))
      }
    })
    client.on('error', reject)
    client.on('close', () =>
      resolve(
        text
          .split('\n')
          .filter(Boolean)
          .map((l) => JSON.parse(l))
      )
    )
  })
}

describe('startCoreSocket', () => {
  test('listens on core.sock, owner-only, in an owner-only folder', async () => {
    const socket = await start()
    assert.equal(socket.path.endsWith('/galleon/core.sock'), true)
    assert.equal(statSync(socket.path).isSocket(), true)
    assert.equal(statSync(socket.path).mode & 0o777, 0o600)
    assert.equal(statSync(join(socket.path, '..')).mode & 0o777, 0o700)
  })

  test('answers a request with its id', async () => {
    const socket = await start()
    assert.deepEqual(await exchange(socket.path, ['{"id":1,"cmd":"status"}\n'], 1), [
      { id: 1, ok: true, result: { cmd: 'status' } }
    ])
  })

  test('a line split across writes is one request, and several lines in one write are several', async () => {
    const socket = await start()
    const answers = await exchange(
      socket.path,
      ['{"id":1,"cm', 'd":"status"}\n{"id":2,"cmd":"quit-app"}\r\n\n{"id":3,"cmd":"nope"}\n'],
      3
    )
    assert.deepEqual(answers, [
      { id: 1, ok: true, result: { cmd: 'status' } },
      { id: 2, ok: true, result: { cmd: 'quit-app' } },
      { id: 3, ok: false, error: 'unknown-command' }
    ])
  })

  test('answers come back in the order asked, however long each takes', async () => {
    const slowFirst: CoreHandler = async (request) => {
      if (request.id === 1) await new Promise((r) => setTimeout(r, 50))
      return { ok: true, result: request.id }
    }
    const socket = await start(slowFirst)
    const answers = await exchange(
      socket.path,
      ['{"id":1,"cmd":"status"}\n{"id":2,"cmd":"status"}\n'],
      2
    )
    assert.deepEqual(
      answers.map((answer) => (answer as { id: number }).id),
      [1, 2]
    )
  })

  test('malformed lines are answered, and the connection stays usable', async () => {
    const socket = await start()
    const answers = await exchange(socket.path, ['not json\n', '{"id":4,"cmd":"status"}\n'], 2)
    assert.deepEqual(answers, [
      { ok: false, error: 'malformed' },
      { id: 4, ok: true, result: { cmd: 'status' } }
    ])
  })

  test('a handler that throws is a failed request, and the server carries on', async () => {
    const socket = await start(() => {
      throw new Error('boom')
    })
    assert.deepEqual(await exchange(socket.path, ['{"id":"a","cmd":"status"}\n'], 1), [
      { id: 'a', ok: false, error: 'failed' }
    ])
    assert.deepEqual(await exchange(socket.path, ['{"cmd":"status"}\n'], 1), [
      { ok: false, error: 'failed' }
    ])
  })

  test('a result that cannot be sent is a failed request, and later requests are still answered', async () => {
    const socket = await start((request) =>
      request.id === 1 ? { ok: true, result: 1n } : { ok: true, result: request.id }
    )
    assert.deepEqual(
      await exchange(socket.path, ['{"id":1,"cmd":"status"}\n{"id":2,"cmd":"status"}\n'], 2),
      [
        { id: 1, ok: false, error: 'failed' },
        { id: 2, ok: true, result: 2 }
      ]
    )
  })

  test('a line that never ends is cut off with too-long', async () => {
    const socket = await start()
    const answers = await exchange(socket.path, ['x'.repeat(MAX_LINE_BYTES + 1)], 1)
    assert.deepEqual(answers, [{ ok: false, error: 'too-long' }])
  })

  test('closing removes the socket file and drops connected clients', async () => {
    const socket = await startCoreSocket(folder(), echoStatus)
    const client = createConnection(socket.path)
    await new Promise((resolve) => client.once('connect', resolve))
    const dropped = new Promise((resolve) => client.once('close', resolve))
    await socket.close()
    await dropped
    assert.equal(existsSync(socket.path), false)
  })

  test('a socket file left by a process that is gone is replaced', async () => {
    const dir = folder()
    const path = join(dir, 'core.sock')
    mkdirSync(dir, { mode: 0o700 })
    // A listener killed outright leaves its file behind, as a crash does.
    const child = spawn(
      process.execPath,
      [
        '-e',
        `require('node:net').createServer().listen(${JSON.stringify(path)}, () => console.log('up'))`
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    )
    await new Promise((resolve) => child.stdout.once('data', resolve))
    child.kill('SIGKILL')
    await new Promise((resolve) => child.once('exit', resolve))
    assert.equal(statSync(path).isSocket(), true)

    const socket = await startCoreSocket(dir, echoStatus)
    closers.push(socket.close)
    assert.deepEqual(await exchange(socket.path, ['{"cmd":"status"}\n'], 1), [
      { ok: true, result: { cmd: 'status' } }
    ])
  })

  test('a live socket belongs to another Galleon and is left alone', async () => {
    const socket = await start()
    await assert.rejects(startCoreSocket(join(socket.path, '..'), echoStatus), CoreSocketInUseError)
    assert.equal(statSync(socket.path).isSocket(), true)
  })

  test('a file that is not a socket is never removed', async () => {
    const dir = folder()
    await startCoreSocket(dir, echoStatus).then((s) => s.close())
    writeFileSync(join(dir, 'core.sock'), 'mine')
    await assert.rejects(startCoreSocket(dir, echoStatus), CoreSocketInUseError)
    assert.equal(statSync(join(dir, 'core.sock')).isFile(), true)
  })
})
