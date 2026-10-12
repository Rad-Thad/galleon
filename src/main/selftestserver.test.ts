import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { ReadOnlyError, RommError, UnreachableError, UnsupportedServerError } from './romm/index.ts'
import { ReadOnlyGuard } from './romm/guard.ts'
import { HEARTBEAT_CHECK, heartbeatScenario } from './selftestserver.ts'
import { runSelfTest, summaryErrors, type CheckResult, type SelfTestRequest } from './selftest.ts'

/**
 * `server.heartbeat` on the device: whether the imported sign-in still reads
 * the owner's server. What matters beyond the verdict is what the summary
 * keeps, since it is published: a version, timings and failure codes, never
 * the account, the address or an error's own words.
 */

const ME = { id: 1, username: 'owners-account', email: 'owner@owners-server.example' }

function fakeClient(options: { version?: string | null; heartbeat?: Error; me?: Error } = {}) {
  const asked: string[] = []
  return {
    asked,
    client: {
      heartbeat: async () => {
        asked.push('heartbeat')
        if (options.heartbeat) throw options.heartbeat
        return { version: options.version === undefined ? '5.4.0' : options.version }
      },
      me: async () => {
        asked.push('me')
        if (options.me) throw options.me
        return ME
      }
    } as never
  }
}

async function check(client: never): Promise<CheckResult> {
  const answered = await heartbeatScenario(client)({
    request: {} as SelfTestRequest,
    safety: {} as never,
    signal: new AbortController().signal
  })
  assert.ok(!Array.isArray(answered))
  return answered
}

describe('server.heartbeat', () => {
  test('passes when both reads answer, and keeps the version but not the account', async () => {
    const { client, asked } = fakeClient()
    const result = await check(client)
    assert.deepEqual(asked, ['heartbeat', 'me'])
    assert.equal(result.id, HEARTBEAT_CHECK)
    assert.equal(result.result, 'pass')
    assert.equal(result.metrics.serverVersion, '5.4.0')
    assert.equal(typeof result.metrics.heartbeatMs, 'number')
    assert.equal(typeof result.metrics.meMs, 'number')
    assert.ok(!JSON.stringify(result).includes('owner'))
  })

  test('a version that is not one is not published', async () => {
    const { client } = fakeClient({ version: 'built on owners-server.example by owner' })
    const result = await check(client)
    assert.equal(result.result, 'pass')
    assert.equal(result.metrics.serverVersion, 'unrecognised')
    assert.equal((await check(fakeClient({ version: null }).client)).metrics.serverVersion, null)
    assert.equal(
      (await check(fakeClient({ version: 'development' }).client)).metrics.serverVersion,
      'development'
    )
  })

  test('a failure is a code, never the error message', async () => {
    const cases: [ReturnType<typeof fakeClient>, string][] = [
      [
        fakeClient({ heartbeat: new UnreachableError('owners-server.example down') }),
        'heartbeat-unreachable'
      ],
      [
        fakeClient({ heartbeat: new UnsupportedServerError('owners-server.example old') }),
        'heartbeat-unsupported'
      ],
      [
        fakeClient({ me: new RommError('owners-server.example says no', 401) }),
        'users-me-http-401'
      ],
      [fakeClient({ me: new ReadOnlyError('refused') }), 'users-me-error']
    ]
    for (const [{ client }, reason] of cases) {
      const result = await check(client)
      assert.equal(result.result, 'fail')
      assert.equal(result.reason, reason)
      assert.ok(!JSON.stringify(result).includes('owners-server'))
    }
  })

  test('a heartbeat that fails does not go on to ask who is signed in', async () => {
    const { client, asked } = fakeClient({ heartbeat: new UnreachableError('down') })
    await check(client)
    assert.deepEqual(asked, ['heartbeat'])
  })

  test('its summary passes the schema, through the runner', async () => {
    const summary = await runSelfTest({
      request: {
        schema: 1,
        sha: 'c'.repeat(40),
        budgetSeconds: 60,
        resultsDir: '/tmp/results',
        handshakeDir: null,
        checks: [HEARTBEAT_CHECK],
        profiles: [],
        payloads: {},
        fakeRomm: null,
        readOnlyServer: true,
        privacy: true,
        abortOnInput: true,
        screenshots: []
      },
      scenarios: new Map([[HEARTBEAT_CHECK, heartbeatScenario(fakeClient().client)]]),
      guard: new ReadOnlyGuard(),
      version: '0.21.0'
    })
    assert.deepEqual(summaryErrors(summary), [])
    assert.equal(summary.status, 'complete')
  })
})
