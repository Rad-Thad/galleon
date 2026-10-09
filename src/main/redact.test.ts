import assert from 'node:assert/strict'
import { test } from 'node:test'
import { IP, redact, REMOVED, SERVER, serverHost } from './redact.ts'

/**
 * A report is handed to someone else, so what these feed in is everything the
 * acceptance names a report must never carry, in the shapes the logs and the
 * settings actually hold it, and the assertion is that none of it survives.
 */

const SECRETS = [
  'romm.home.example',
  'rmm_4f9aXq_secretTOKEN-123',
  'eyJhbGciOiJIUzI1NiJ9.payload.sig',
  'hunter2',
  'sessionid=abc123',
  'csrftoken=zzz',
  'WXYZ-1234',
  'dev-code-98765',
  '192.168.1.40',
  '10.0.0.7',
  'fe80::1c2d:3e4f:5a6b:7c8d',
  '2001:db8:85a3:0:0:8a2e:370:7334',
  '::1'
]

const LOG = [
  '2026-10-09T16:27:01.000Z INFO  romm       GET https://romm.home.example:8080/api/roms {"status":200}',
  '2026-10-09T16:27:02.000Z INFO  romm       client token rmm_4f9aXq_secretTOKEN-123 accepted',
  'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig',
  '{"username":"me","password":"hunter2"}',
  'login with password=hunter2&next=/',
  'Cookie: sessionid=abc123; csrftoken=zzz',
  '{"user_code":"WXYZ-1234","device_code":"dev-code-98765"}',
  'connecting to 192.168.1.40 and 10.0.0.7',
  'bound fe80::1c2d:3e4f:5a6b:7c8d and [2001:db8:85a3:0:0:8a2e:370:7334]:443 and ::1'
].join('\n')

test('nothing the acceptance names survives a log that holds all of it', () => {
  const out = redact(LOG, { serverUrl: 'https://romm.home.example:8080' })
  for (const secret of SECRETS) assert.ok(!out.includes(secret), `${secret} survived:\n${out}`)
  assert.match(out, new RegExp(`https://${SERVER}:8080/api/roms`))
  assert.ok(out.includes(IP))
  assert.ok(out.includes(REMOVED))
})

test('the server host goes whatever its case, and an address-shaped host is named as the server', () => {
  assert.equal(
    redact('ROMM.Home.Example/x', { serverUrl: 'https://romm.home.example' }),
    `${SERVER}/x`
  )
  assert.equal(
    redact('http://10.1.2.3:8080/api', { serverUrl: 'http://10.1.2.3:8080' }),
    `http://${SERVER}:8080/api`
  )
  assert.equal(serverHost('http://[fd00::5]:80'), 'fd00::5')
  assert.equal(redact('at fd00::5 now', { serverUrl: 'http://[fd00::5]:80' }), `at ${SERVER} now`)
  assert.equal(serverHost('not a url'), null)
  assert.equal(serverHost(null), null)
})

test('times, versions of fewer parts and code that merely has colons are left as they are', () => {
  const ordinary = '2026-10-09T16:27:01.000Z electron 44.5.1 std::vector a:b ratio 4:3 1280x960'
  assert.equal(redact(ordinary), ordinary)
})

test('a token in a query string or as a key is removed, with the key kept to say what was there', () => {
  assert.equal(redact('GET /x?token=abc&y=1'), `GET /x?token=${REMOVED}&y=1`)
  assert.equal(redact('"access_token": "abc"'), `"access_token": "${REMOVED}"`)
  assert.equal(redact('Basic dXNlcjpwYXNz'), `Basic ${REMOVED}`)
})
