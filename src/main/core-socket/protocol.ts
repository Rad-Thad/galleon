/**
 * Reading the core socket's lines. See `CORE_COMMANDS`.
 *
 * JSON lines rather than anything richer because every client the socket has
 * is small: a Decky panel in Python, a shell script on the device, a fallback
 * UI. Each can write one line and read one back with what its language already
 * has, and none needs a schema compiler to do it.
 *
 * Nothing a client sends is trusted to be well formed, so this never throws:
 * every line becomes a request or a reason it is not one, and the reason goes
 * back on the same connection.
 */

import {
  CORE_COMMANDS,
  type CoreCommand,
  type CoreRequest,
  type CoreRequestError,
  type CoreRequestId,
  type CoreResponse
} from '@shared/types'

/**
 * The longest line read as a request.
 *
 * Every real request is a few dozen bytes; the cap is what keeps a client that
 * never sends a newline from growing the main process's buffer without end.
 */
export const MAX_LINE_BYTES = 4096

export type ParsedLine =
  { ok: true; request: CoreRequest } | { ok: false; id?: CoreRequestId; error: CoreRequestError }

function isCommand(value: unknown): value is CoreCommand {
  return (CORE_COMMANDS as readonly unknown[]).includes(value)
}

function isId(value: unknown): value is CoreRequestId {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))
}

/**
 * One line, without its newline, as a request.
 *
 * The id is echoed even on a refusal when it can be read, so a client with
 * several requests in flight can tell which one was turned down.
 */
export function parseCoreRequest(line: string): ParsedLine {
  if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) return { ok: false, error: 'too-long' }
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return { ok: false, error: 'malformed' }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, error: 'malformed' }
  }
  const record = value as Record<string, unknown>
  const id = isId(record.id) ? record.id : undefined
  const echo = id === undefined ? {} : { id }
  if ('id' in record && id === undefined) return { ok: false, error: 'malformed' }
  if (typeof record.cmd !== 'string') return { ok: false, ...echo, error: 'malformed' }
  if (!isCommand(record.cmd)) return { ok: false, ...echo, error: 'unknown-command' }
  return { ok: true, request: { ...echo, cmd: record.cmd } }
}

/** An answer as the one line that carries it, newline included. */
export function encodeCoreResponse(response: CoreResponse): string {
  return `${JSON.stringify(response)}\n`
}
