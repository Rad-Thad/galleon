/**
 * The core socket's listener: framing, dispatch and its own file. See
 * `parseCoreRequest` for what a line may hold.
 *
 * What each command does is not decided here. The caller passes one handler,
 * so this file owns only what every command shares: one request per line, one
 * answer per request in the order asked, a line that never ends cut off, and a
 * socket file that exists only while something is listening on it.
 */

import { chmodSync, lstatSync, mkdirSync, unlinkSync } from 'node:fs'
import { createConnection, createServer, type Server, type Socket } from 'node:net'
import { join } from 'node:path'
import type { CoreRequest, CoreResponse } from '@shared/types'
import { MAX_LINE_BYTES, encodeCoreResponse, parseCoreRequest } from './protocol.ts'

/** Answers one request. Its `id` is put on the answer by the server. */
export type CoreHandler = (
  request: CoreRequest
) => Omit<CoreResponse, 'id'> | Promise<Omit<CoreResponse, 'id'>>

export interface CoreSocket {
  path: string
  /** Stop listening, drop every client, and remove the socket file. */
  close: () => Promise<void>
}

export class CoreSocketInUseError extends Error {
  constructor(readonly path: string) {
    super(`another process is listening on ${path}`)
  }
}

/**
 * Whether the socket at `path` is dead: refused, with nothing listening.
 *
 * Only a refusal counts. Any other failure (a full backlog, a socket this user
 * may not connect to) can be a live listener, and is treated as one.
 */
function isDead(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createConnection(path)
    probe.once('connect', () => {
      probe.destroy()
      resolve(false)
    })
    probe.once('error', (error: NodeJS.ErrnoException) => resolve(error.code === 'ECONNREFUSED'))
  })
}

/**
 * Clear the way for a new socket at `path`.
 *
 * A socket file outlives a process that crashed, and binding over it fails, so
 * a dead one is removed. A live one belongs to another Galleon in the same
 * session and is left alone; anything that is not a socket is never removed,
 * whatever put it there.
 */
async function clearStale(path: string): Promise<void> {
  let stat
  try {
    stat = lstatSync(path)
  } catch {
    return
  }
  if (!stat.isSocket() || !(await isDead(path))) throw new CoreSocketInUseError(path)
  unlinkSync(path)
}

/** One client: lines in, answers out, in order. */
function serve(client: Socket, handle: CoreHandler): void {
  let buffered = ''
  // Answers chain so a slow command never lets a later quick one overtake it,
  // which a client matching answers to requests by order would misread.
  let queue = Promise.resolve()
  const answer = (respond: () => Promise<string>): void => {
    queue = queue
      .then(async () => {
        const line = await respond()
        if (!client.destroyed) client.write(line)
      })
      // A link that rejects would skip every later one, leaving this client
      // waiting forever; one it cannot be answered on is dropped instead.
      .catch(() => {
        client.destroy()
      })
  }

  client.setEncoding('utf8')
  client.on('data', (chunk: string) => {
    buffered += chunk
    let newline: number
    while ((newline = buffered.indexOf('\n')) !== -1) {
      const line = buffered.slice(0, newline).replace(/\r$/, '')
      buffered = buffered.slice(newline + 1)
      if (line.trim() === '') continue
      answer(async () => {
        const parsed = parseCoreRequest(line)
        if (!parsed.ok) {
          const { ok, ...refusal } = parsed
          return encodeCoreResponse({ ...refusal, ok })
        }
        const echo = parsed.request.id === undefined ? {} : { id: parsed.request.id }
        // Encoded inside the try: a result JSON cannot carry is as much a
        // failure of the request as a handler that throws.
        try {
          return encodeCoreResponse({ ...echo, ...(await handle(parsed.request)) } as CoreResponse)
        } catch {
          return encodeCoreResponse({ ...echo, ok: false, error: 'failed' })
        }
      })
    }
    if (Buffer.byteLength(buffered, 'utf8') > MAX_LINE_BYTES) {
      buffered = ''
      answer(async () => encodeCoreResponse({ ok: false, error: 'too-long' }))
      queue = queue.then(() => {
        client.end()
      })
    }
  })
  client.on('error', () => client.destroy())
}

/**
 * Listen on `core.sock` in `dir`, readable and writable by its owner only.
 *
 * The folder is made owner-only too: a socket's own mode is not honoured on
 * every system, and the folder's is.
 */
export async function startCoreSocket(dir: string, handle: CoreHandler): Promise<CoreSocket> {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)
  const path = join(dir, 'core.sock')
  await clearStale(path)

  const clients = new Set<Socket>()
  const server: Server = createServer((client) => {
    clients.add(client)
    client.once('close', () => clients.delete(client))
    serve(client, handle)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(path, () => {
      server.off('error', reject)
      resolve()
    })
  })
  chmodSync(path, 0o600)

  return {
    path,
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of clients) client.destroy()
        server.close(() => resolve())
      })
  }
}
