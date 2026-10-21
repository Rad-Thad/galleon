import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createConnection, createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { peerUid } from './peercred.ts'

/** Over a real Unix socket: the user id comes from the kernel, not the code. */
let root: string | null = null
let server: Server | null = null

afterEach(async () => {
  if (server) await new Promise((r) => server!.close(r))
  server = null
  if (root) rmSync(root, { recursive: true, force: true })
  root = null
})

/** A connected pair: the server's end of it is what `peerUid` is asked about. */
async function connected(): Promise<{ accepted: Socket; client: Socket }> {
  root = mkdtempSync(join(tmpdir(), 'peercred-'))
  const path = join(root, 'test.sock')
  const accepted = new Promise<Socket>((resolve) => {
    server = createServer((socket) => {
      socket.pause()
      resolve(socket)
    })
  })
  await new Promise<void>((resolve) => server!.listen(path, resolve))
  const client = createConnection(path)
  await new Promise((resolve) => client.once('connect', resolve))
  return { accepted: await accepted, client }
}

/** An executable in the test folder standing in for Python. */
function fakePython(body: string): string {
  const path = join(root!, 'python3')
  writeFileSync(path, `#!/bin/sh\n${body}\n`)
  chmodSync(path, 0o755)
  return path
}

describe('peerUid', () => {
  test('names the user who connected, and leaves the connection usable', async () => {
    const { accepted, client } = await connected()
    client.write('hello\n')
    assert.equal(await peerUid(accepted), process.getuid!())
    accepted.resume()
    accepted.setEncoding('utf8')
    const first = await new Promise((resolve) => accepted.once('data', resolve))
    assert.equal(first, 'hello\n')
    accepted.write('back\n')
    client.setEncoding('utf8')
    assert.equal(await new Promise((resolve) => client.once('data', resolve)), 'back\n')
    client.destroy()
    accepted.destroy()
  })

  test('no Python is no answer', async () => {
    const { accepted, client } = await connected()
    assert.equal(await peerUid(accepted, join(root!, 'missing')), null)
    client.destroy()
    accepted.destroy()
  })

  test('a helper that fails, or prints something other than a number, is no answer', async () => {
    const { accepted, client } = await connected()
    assert.equal(await peerUid(accepted, fakePython('echo 1000; exit 1')), null)
    assert.equal(await peerUid(accepted, fakePython('echo root')), null)
    assert.equal(await peerUid(accepted, fakePython('echo')), null)
    client.destroy()
    accepted.destroy()
  })

  test('a helper that hangs is no answer once the time is up', async () => {
    const { accepted, client } = await connected()
    const started = Date.now()
    assert.equal(await peerUid(accepted, fakePython('exec sleep 30'), 100), null)
    assert.ok(Date.now() - started < 5000)
    client.destroy()
    accepted.destroy()
  })

  test('a socket already gone is no answer, not a throw', async () => {
    const { accepted, client } = await connected()
    accepted.destroy()
    client.destroy()
    assert.equal(await peerUid(accepted), null)
  })
})
