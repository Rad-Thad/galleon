import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { ReadOnlyError, RommError, UnreachableError, UnsupportedServerError } from './romm/index.ts'
import { ReadOnlyGuard } from './romm/guard.ts'
import {
  HEARTBEAT_CHECK,
  SCHEME_CHECK,
  heartbeatScenario,
  schemeProbeScenario
} from './selftestserver.ts'
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
        version: null,
        budgetSeconds: 60,
        deadline: null,
        resultsDir: '/tmp/results',
        handshakeDir: null,
        checks: [HEARTBEAT_CHECK],
        profiles: [],
        payloads: {},
        savingPayloads: [],
        steamTarget: null,
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

describe('server.scheme-probe', () => {
  const IMPORTED = 'http://owners-server.example:8080'

  /** A server that is RomM only at `romm`; everything else is nothing answering. */
  function probing(romm: string[], heartbeat?: Error) {
    const asked: string[] = []
    return {
      asked,
      client: {
        probe: async (url: string) => {
          asked.push(`probe ${url}`)
          return romm.includes(url)
            ? { kind: 'romm' as const }
            : { kind: 'unreachable' as const, reason: `nothing at ${url}` }
        },
        heartbeat: async (url?: string) => {
          asked.push(`heartbeat ${url}`)
          if (heartbeat) throw heartbeat
          return { version: '5.4.0' }
        }
      } as never
    }
  }

  async function run(client: never, address: string | null): Promise<CheckResult> {
    const answered = await schemeProbeScenario(
      client,
      () => address
    )({
      request: {} as SelfTestRequest,
      safety: {} as never,
      signal: new AbortController().signal
    })
    assert.ok(!Array.isArray(answered))
    return answered
  }

  test('finds http after https for a plain http server, and reaches the heartbeat there', async () => {
    const { client, asked } = probing([IMPORTED])
    const result = await run(client, IMPORTED)
    assert.equal(result.id, SCHEME_CHECK)
    assert.equal(result.result, 'pass')
    assert.deepEqual(asked, [
      'probe https://owners-server.example:8080',
      `probe ${IMPORTED}`,
      `heartbeat ${IMPORTED}`
    ])
    assert.equal(result.metrics.scheme, 'http')
    assert.equal(result.metrics.importedScheme, 'http')
    assert.equal(result.metrics.attempts, 2)
    assert.ok(!JSON.stringify(result).includes('owners-server'))
  })

  test('an https server is found at the first attempt', async () => {
    const https = 'https://owners-server.example'
    const { client } = probing([https])
    const result = await run(client, https)
    assert.equal(result.result, 'pass')
    assert.equal(result.metrics.scheme, 'https')
    assert.equal(result.metrics.attempts, 1)
  })

  test('nothing answering like RomM fails with a code and no address', async () => {
    const { client, asked } = probing([])
    const result = await run(client, IMPORTED)
    assert.equal(result.result, 'fail')
    assert.equal(result.reason, 'probe-unreachable')
    assert.equal(asked.length, 2)
    assert.ok(!JSON.stringify(result).includes('owners-server'))
  })

  test('a heartbeat that fails where the scheme was found fails the check', async () => {
    const { client } = probing([IMPORTED], new UnsupportedServerError('too old'))
    const result = await run(client, IMPORTED)
    assert.equal(result.result, 'fail')
    assert.equal(result.reason, 'heartbeat-unsupported')
  })

  test('without a server there is nothing to probe', async () => {
    const { client, asked } = probing([IMPORTED])
    const result = await run(client, null)
    assert.equal(result.reason, 'no-server')
    assert.deepEqual(asked, [])
  })
})

test('server.scheme-probe names a refused certificate apart from no answer', async () => {
  const client = {
    probe: async () => ({ kind: 'tls' as const, reason: 'self-signed' }),
    heartbeat: async () => ({ version: '5.4.0' })
  } as never
  const answered = await schemeProbeScenario(
    client,
    () => 'https://owners-server.example'
  )({
    request: {} as SelfTestRequest,
    safety: {} as never,
    signal: new AbortController().signal
  })
  assert.ok(!Array.isArray(answered))
  assert.equal(answered.reason, 'probe-tls')
  assert.equal(answered.metrics.attempts, 1)
})
