import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { operationFor, problemsWith, requestProblems, type OpenApiDocument } from './schema.mjs'

const doc: OpenApiDocument = {
  info: { version: '9.9.9' },
  paths: {
    '/api/things': {
      post: {
        parameters: [
          { name: 'rom_id', in: 'query', required: true },
          { name: 'note', in: 'query' }
        ],
        requestBody: {
          required: true,
          content: { 'multipart/form-data': { schema: { $ref: '#/components/schemas/Upload' } } }
        }
      }
    },
    '/api/things/{id}/content/{file_name}': { get: { parameters: [] } },
    '/api/sessions': {
      post: {
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Sessions' } } }
        }
      }
    }
  },
  components: {
    schemas: {
      Upload: { type: 'object', properties: { file: {} }, required: ['file'] },
      Sessions: {
        type: 'object',
        properties: {
          device_id: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          sessions: { type: 'array', items: { $ref: '#/components/schemas/Session' } }
        },
        required: ['sessions']
      },
      Session: {
        type: 'object',
        properties: {
          rom_id: { type: 'integer' },
          duration_ms: { type: 'number' },
          mode: { enum: ['a', 'b'] }
        },
        required: ['rom_id']
      }
    }
  }
}

const form = (...fields: string[]): FormData => {
  const f = new FormData()
  for (const field of fields) f.append(field, new Blob(['x']), 'x.bin')
  return f
}

test('a path matches its template, placeholders standing for one segment', () => {
  assert.equal(
    operationFor(doc, 'GET', '/api/things/7/content/a%20b.bin')?.template,
    '/api/things/{id}/content/{file_name}'
  )
  assert.equal(operationFor(doc, 'GET', '/api/things/7/8/content/a.bin'), null)
  assert.equal(operationFor(doc, 'DELETE', '/api/things'), null)
})

test('an unknown operation is a problem, named with the version', () => {
  assert.deepEqual(requestProblems(doc, { method: 'GET', url: 'http://h/api/nope' }), [
    'GET /api/nope: no such operation in RomM 9.9.9'
  ])
})

test('query names must be declared, and required ones sent', () => {
  const url = 'http://h/api/things?note=x&overwrite=true'
  assert.deepEqual(requestProblems(doc, { method: 'POST', url, body: form('file') }), [
    'POST /api/things: query overwrite is not declared',
    'POST /api/things: query rom_id is required and missing'
  ])
})

test('a form is held to its field names', () => {
  const url = 'http://h/api/things?rom_id=1'
  assert.deepEqual(requestProblems(doc, { method: 'POST', url, body: form('file') }), [])
  assert.deepEqual(requestProblems(doc, { method: 'POST', url, body: form('saveFile') }), [
    'POST /api/things: form field saveFile is not in the schema',
    'POST /api/things: form field file is required and missing'
  ])
  assert.deepEqual(requestProblems(doc, { method: 'POST', url }), [
    'POST /api/things: a body is required and none was sent'
  ])
  assert.deepEqual(requestProblems(doc, { method: 'POST', url, body: '{}' }), [
    'POST /api/things: sent JSON, the operation takes none'
  ])
})

test('a JSON body is held to its schema through refs, unions, arrays and enums', () => {
  const url = 'http://h/api/sessions'
  const ok = JSON.stringify({ device_id: null, sessions: [{ rom_id: 1, duration_ms: 5000 }] })
  assert.deepEqual(requestProblems(doc, { method: 'POST', url, body: ok }), [])

  const bad = JSON.stringify({
    device_id: 4,
    sessions: [{ rom_id: '1', mode: 'c', extra: true }]
  })
  assert.deepEqual(requestProblems(doc, { method: 'POST', url, body: bad }), [
    'POST /api/sessions.device_id: 4 fits none of its 2 shapes',
    'POST /api/sessions.sessions[0].rom_id: string, the schema says integer',
    'POST /api/sessions.sessions[0].mode: "c" is not one of a, b',
    'POST /api/sessions.sessions[0].extra: not in the schema'
  ])
  assert.deepEqual(requestProblems(doc, { method: 'POST', url, body: 'not json' }), [
    'POST /api/sessions: the body is not JSON'
  ])
  assert.deepEqual(requestProblems(doc, { method: 'POST', url, body: form('file') }), [
    'POST /api/sessions: sent a form, the operation takes none'
  ])
})

test('open objects take any field, and typed ones hold each to the type', () => {
  assert.deepEqual(problemsWith(doc, { type: 'object', additionalProperties: true }, { a: 1 }), [])
  assert.deepEqual(
    problemsWith(doc, { type: 'object', additionalProperties: { type: 'string' } }, { a: 1 }),
    ['body.a: integer, the schema says string']
  )
  assert.deepEqual(problemsWith(doc, { allOf: [{ type: 'object', required: ['a'] }] }, {}), [
    'body.a: required and missing'
  ])
  assert.deepEqual(problemsWith(doc, { const: 'x' }, 'y'), ['body: "y" is not "x"'])
  assert.throws(() => problemsWith(doc, { $ref: '#/components/schemas/Missing' }, 1), /Missing/)
})

test('every committed RomM document has the operations the client sends bodies to', () => {
  for (const file of readdirSync('schema').filter((name) => /^romm-5\.[23]/.test(name))) {
    const document = JSON.parse(readFileSync(`schema/${file}`, 'utf8')) as OpenApiDocument
    for (const [method, path] of [
      ['POST', '/api/saves'],
      ['POST', '/api/states'],
      ['POST', '/api/devices'],
      ['POST', '/api/play-sessions']
    ]) {
      assert.ok(operationFor(document, method, path), `${file}: ${method} ${path}`)
    }
  }
})
