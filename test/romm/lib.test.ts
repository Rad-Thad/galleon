import { test } from 'node:test'
import assert from 'node:assert/strict'
import { REQUIRED_SCOPES } from '../../src/main/romm/client.ts'
import {
  PROFILES,
  TOKEN_SCOPES,
  basicAuth,
  cookieHeader,
  eventPacket,
  mergeCookies,
  parseArgs,
  profilesFrom,
  parsePacket,
  splitPackets,
  statePath,
  waitForHeartbeat
} from './lib.mjs'

test('the provisioned token can do everything the app asks a pairing for', () => {
  for (const scope of REQUIRED_SCOPES) assert.ok(TOKEN_SCOPES.includes(scope), scope)
})

test('each profile is the RomM version it names, on loopback', () => {
  assert.deepEqual(Object.keys(PROFILES).sort(), ['v520', 'v531'])
  for (const [name, { baseUrl, version }] of Object.entries(PROFILES)) {
    assert.equal(name, `v${version.replaceAll('.', '')}`)
    assert.match(baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/)
  }
})

test('a polling body splits on the record separator, and an empty one holds nothing', () => {
  assert.deepEqual(splitPackets(''), [])
  assert.deepEqual(splitPackets('2'), ['2'])
  assert.deepEqual(splitPackets('40{"sid":"a"}\x1e2'), ['40{"sid":"a"}', '2'])
})

test('packets are told apart by their Engine.IO and Socket.IO types', () => {
  assert.deepEqual(parsePacket('0{"sid":"x","pingInterval":25000}'), {
    kind: 'open',
    data: { sid: 'x', pingInterval: 25000 }
  })
  assert.deepEqual(parsePacket('1'), { kind: 'close' })
  assert.deepEqual(parsePacket('2'), { kind: 'ping' })
  assert.deepEqual(parsePacket('6'), { kind: 'noop' })
  assert.deepEqual(parsePacket('40{"sid":"y"}'), { kind: 'connect' })
  assert.deepEqual(parsePacket('41'), { kind: 'disconnect' })
  assert.deepEqual(parsePacket('44{"message":"no"}'), {
    kind: 'connect_error',
    data: { message: 'no' }
  })
  assert.deepEqual(parsePacket('44'), { kind: 'connect_error', data: null })
  assert.deepEqual(parsePacket('42["scan:done",{"n":2}]'), {
    kind: 'event',
    event: 'scan:done',
    args: [{ n: 2 }]
  })
  // An acknowledgement id between the type and the payload is not part of it.
  assert.deepEqual(parsePacket('4212["scan:done_ko","boom"]'), {
    kind: 'event',
    event: 'scan:done_ko',
    args: ['boom']
  })
  assert.deepEqual(parsePacket('3'), { kind: 'other', packet: '3' })
  assert.deepEqual(parsePacket('43'), { kind: 'other', packet: '43' })
})

test('an event is framed as a Socket.IO message the server reads back', () => {
  const packet = eventPacket('scan', { platforms: [], type: 'quick', apis: [] })
  assert.equal(packet, '42["scan",{"platforms":[],"type":"quick","apis":[]}]')
  assert.deepEqual(parsePacket(packet), {
    kind: 'event',
    event: 'scan',
    args: [{ platforms: [], type: 'quick', apis: [] }]
  })
})

test('set cookies merge into the jar by name, attributes dropped', () => {
  const jar = mergeCookies({ a: '1' }, [
    'romm_csrftoken=tok; Path=/; SameSite=Lax',
    'a=2; HttpOnly',
    'broken',
    '=nameless'
  ])
  assert.deepEqual(jar, { a: '2', romm_csrftoken: 'tok' })
  assert.equal(cookieHeader(jar), 'a=2; romm_csrftoken=tok')
  assert.equal(cookieHeader({}), '')
})

test('basic auth encodes the user and password', () => {
  assert.equal(basicAuth({ username: 'u', password: 'p:w' }), `Basic ${btoa('u:p:w')}`)
})

test('arguments name a known profile, and anything else is refused by name', () => {
  assert.deepEqual(parseArgs([]), { profile: 'v520' })
  assert.deepEqual(parseArgs(['--profile', 'v531']), { profile: 'v531' })
  assert.throws(() => parseArgs(['--profile', 'v999']), /unknown profile v999/)
  assert.throws(() => parseArgs(['--profile']), /unknown argument: --profile/)
  assert.throws(() => parseArgs(['--url', 'x']), /unknown argument: --url/)
})

test('state is written per profile, beside the compose file', () => {
  assert.match(statePath('v531'), /test\/romm\/\.state\/v531\.json$/)
})

test('the heartbeat wait returns the first healthy answer', async () => {
  const answers = [new Error('refused'), new Response('', { status: 502 }), new Response('{}')]
  const fetchImpl = async () => {
    const next = answers.shift()
    if (next instanceof Error) throw next
    return next as Response
  }
  const res = await waitForHeartbeat('http://127.0.0.1:1', {
    timeoutMs: 10_000,
    intervalMs: 1,
    fetchImpl
  })
  assert.equal(res.status, 200)
})

test('the heartbeat wait names the last failure when it gives up', async () => {
  const fetchImpl = async () => new Response('', { status: 503 })
  await assert.rejects(
    waitForHeartbeat('http://127.0.0.1:1', { timeoutMs: 1, intervalMs: 1, fetchImpl }),
    /did not answer its heartbeat in time \(HTTP 503\)/
  )
  const refusing = async () => {
    throw 'down'
  }
  await assert.rejects(
    waitForHeartbeat('http://127.0.0.1:1', { timeoutMs: 1, intervalMs: 1, fetchImpl: refusing }),
    /\(down\)/
  )
})

test('test:romm runs every profile by default, or the ones named, once each', () => {
  assert.deepEqual(profilesFrom([]), ['v520', 'v531'])
  assert.deepEqual(profilesFrom(['--profile', 'v531']), ['v531'])
  assert.deepEqual(profilesFrom(['--profile', 'v531', '--profile', 'v520', '--profile', 'v531']), [
    'v531',
    'v520'
  ])
  assert.throws(() => profilesFrom(['--profile', 'v999']), /unknown profile v999/)
  assert.throws(() => profilesFrom(['--profile']), /unknown argument/)
})
