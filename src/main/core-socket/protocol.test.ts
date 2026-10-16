import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { CORE_COMMANDS } from '@shared/types'
import { MAX_LINE_BYTES, encodeCoreResponse, parseCoreRequest } from './protocol.ts'

/**
 * The socket's lines come from programs Galleon does not ship, so every shape a
 * line can take has to come back as a request or a named refusal, never as a
 * throw that would take the main process with it.
 */
describe('parseCoreRequest', () => {
  test('every command is read, with and without an id', () => {
    for (const cmd of CORE_COMMANDS) {
      assert.deepEqual(parseCoreRequest(JSON.stringify({ cmd })), { ok: true, request: { cmd } })
      assert.deepEqual(parseCoreRequest(JSON.stringify({ id: 7, cmd })), {
        ok: true,
        request: { id: 7, cmd }
      })
      assert.deepEqual(parseCoreRequest(JSON.stringify({ id: 'a', cmd })), {
        ok: true,
        request: { id: 'a', cmd }
      })
    }
  })

  test('fields beyond id and cmd are dropped', () => {
    assert.deepEqual(parseCoreRequest('{"cmd":"status","extra":{"x":1}}'), {
      ok: true,
      request: { cmd: 'status' }
    })
  })

  test('a line that is not JSON is malformed', () => {
    for (const line of ['', ' ', 'status', '{"cmd":"status"', '{cmd:"status"}', '\u0000']) {
      assert.deepEqual(parseCoreRequest(line), { ok: false, error: 'malformed' }, line)
    }
  })

  test('JSON that is not an object is malformed', () => {
    for (const line of ['null', '1', '"status"', 'true', '[]', '[{"cmd":"status"}]']) {
      assert.deepEqual(parseCoreRequest(line), { ok: false, error: 'malformed' }, line)
    }
  })

  test('an object without a string cmd is malformed, with its id echoed', () => {
    assert.deepEqual(parseCoreRequest('{}'), { ok: false, error: 'malformed' })
    assert.deepEqual(parseCoreRequest('{"id":3,"cmd":5}'), { ok: false, id: 3, error: 'malformed' })
    assert.deepEqual(parseCoreRequest('{"id":"x","cmd":null}'), {
      ok: false,
      id: 'x',
      error: 'malformed'
    })
  })

  test('an id that is neither a string nor a finite number is malformed', () => {
    for (const id of ['null', '{}', '[]', 'true', '1e400']) {
      assert.deepEqual(
        parseCoreRequest(`{"id":${id},"cmd":"status"}`),
        { ok: false, error: 'malformed' },
        id
      )
    }
  })

  test('an unknown command is named as such, with its id echoed', () => {
    assert.deepEqual(parseCoreRequest('{"id":1,"cmd":"rm -rf"}'), {
      ok: false,
      id: 1,
      error: 'unknown-command'
    })
    assert.deepEqual(parseCoreRequest('{"cmd":"STATUS"}'), { ok: false, error: 'unknown-command' })
    assert.deepEqual(parseCoreRequest('{"cmd":"toString"}'), {
      ok: false,
      error: 'unknown-command'
    })
  })

  test('a line over the cap is refused before it is parsed', () => {
    const padded = JSON.stringify({ cmd: 'status', pad: 'x'.repeat(MAX_LINE_BYTES) })
    assert.deepEqual(parseCoreRequest(padded), { ok: false, error: 'too-long' })
  })

  test('the cap counts bytes, not characters', () => {
    const fits = `{"cmd":"status","pad":"${'x'.repeat(MAX_LINE_BYTES - 30)}"}`
    assert.equal(parseCoreRequest(fits).ok, true)
    const wide = `{"cmd":"status","pad":"${'é'.repeat(MAX_LINE_BYTES / 2)}"}`
    assert.ok(wide.length <= MAX_LINE_BYTES + 30)
    assert.deepEqual(parseCoreRequest(wide), { ok: false, error: 'too-long' })
  })
})

describe('encodeCoreResponse', () => {
  test('one line, ending in a newline, that parses back', () => {
    const line = encodeCoreResponse({ id: 2, ok: false, error: 'game-running' })
    assert.equal(line.endsWith('\n'), true)
    assert.equal(line.slice(0, -1).includes('\n'), false)
    assert.deepEqual(JSON.parse(line), { id: 2, ok: false, error: 'game-running' })
  })

  test('a result with newlines in its strings stays on one line', () => {
    const line = encodeCoreResponse({ ok: true, result: { text: 'a\nb' } })
    assert.equal(line.split('\n').length, 2)
  })
})
