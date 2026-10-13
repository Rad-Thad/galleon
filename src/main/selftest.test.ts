import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ReadOnlyGuard } from './romm/guard.ts'
import {
  REQUEST_FILE,
  RUN_CHECKS,
  SKIP,
  SUMMARY_FILE,
  TAKEN_FILE,
  parseRequest,
  reportRefusal,
  runAndReport,
  runSelfTest,
  summaryErrors,
  takeRequest,
  type CheckResult,
  type Scenario,
  type SelfTestRequest,
  type Summary
} from './selftest.ts'

/**
 * The device self-test's request and summary.
 *
 * The summary is all the agent ever learns of a run on the Nova, and it learns
 * it a night later, so what can go wrong in writing it is found here instead:
 * a request taken twice, one run without the safety it asks for, a scenario
 * that throws and takes the rest of the run with it, a summary the ingestion
 * cannot read.
 */

const SHA = 'a'.repeat(40)
const scratches: string[] = []

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'galleon-selftest-test-'))
  scratches.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of scratches.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function rawRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 1,
    sha: SHA,
    budgetSeconds: 1800,
    resultsDir: '/tmp/results',
    handshakeDir: '/tmp/handshake',
    checks: ['selftest.complete', 'startup.cold'],
    profiles: ['performance', 'balanced'],
    payloads: { retroarch: 'payloads/snes/hello.sfc' },
    fakeRomm: null,
    readOnlyServer: true,
    privacy: true,
    abortOnInput: true,
    screenshots: [],
    ...overrides
  }
}

function request(overrides: Record<string, unknown> = {}): SelfTestRequest {
  const taken = parseRequest(rawRequest(overrides))
  assert.equal(taken.kind, 'request')
  return taken.request
}

function pass(id: string): CheckResult {
  return {
    id,
    result: 'pass',
    metrics: { ms: 1 },
    thresholds: { ms: 2 },
    reason: null,
    evidence: []
  }
}

function byId(summary: Summary): Map<string, CheckResult> {
  return new Map(summary.checks.map((c) => [c.id, c]))
}

/** The `summary.json` example in docs/TESTING.md, so the doc and the code cannot drift. */
function documentedSummary(): unknown {
  const doc = readFileSync(join(import.meta.dirname, '../../docs/TESTING.md'), 'utf8')
  const section = doc.slice(doc.indexOf('## `summary.json`'))
  const block = /```json\n([\s\S]*?)```/.exec(section)
  assert.ok(block, 'TESTING.md has a summary.json example')
  return JSON.parse(block[1].replace('<40-hex commit>', SHA))
}

function documentedRequest(): unknown {
  const doc = readFileSync(join(import.meta.dirname, '../../docs/TESTING.md'), 'utf8')
  const section = doc.slice(doc.indexOf('## `self-test-request.json`'))
  const block = /```json\n([\s\S]*?)```/.exec(section)
  assert.ok(block, 'TESTING.md has a request example')
  // The example's placeholders, filled the way run.sh fills them.
  return JSON.parse(block[1].replace('<40-hex commit>', SHA).replaceAll('<user>', 'deck'))
}

describe('taking the request', () => {
  test('only a GALLEON_HOME is looked in', () => {
    assert.equal(takeRequest(undefined), null)
  })

  test('no request is a normal start', () => {
    assert.equal(takeRequest(scratch()), null)
  })

  test('the request is renamed when taken, so a restart does not run it again', () => {
    const home = scratch()
    writeFileSync(join(home, REQUEST_FILE), JSON.stringify(rawRequest()))
    const taken = takeRequest(home)
    assert.equal(taken?.kind, 'request')
    assert.ok(!existsSync(join(home, REQUEST_FILE)))
    assert.ok(existsSync(join(home, TAKEN_FILE)))
    assert.equal(takeRequest(home), null)
  })

  test('an unreadable request is taken too, and refused', () => {
    const home = scratch()
    writeFileSync(join(home, REQUEST_FILE), '{ not json')
    assert.deepEqual(takeRequest(home), {
      kind: 'refused',
      reason: 'request-unreadable',
      resultsDir: null,
      sha: null
    })
    assert.equal(takeRequest(home), null)
  })

  test('the example in docs/TESTING.md is accepted', () => {
    const taken = parseRequest(documentedRequest())
    assert.equal(taken.kind, 'request')
  })

  test("the build's version is taken when given, and null when not", () => {
    assert.equal(request({ version: '0.21.0' }).version, '0.21.0')
    assert.equal(request().version, null)
  })

  test('a request without the read-only server or privacy is refused, not forced', () => {
    for (const [overrides, reason] of [
      [{ readOnlyServer: false }, 'request-not-read-only'],
      [{ readOnlyServer: undefined }, 'request-not-read-only'],
      [{ privacy: false }, 'request-not-private'],
      [{ privacy: 'yes' }, 'request-not-private']
    ] as const) {
      assert.deepEqual(parseRequest(rawRequest(overrides)), {
        kind: 'refused',
        reason,
        resultsDir: '/tmp/results',
        sha: SHA
      })
    }
  })

  test('a malformed request is refused with a reason', () => {
    for (const [overrides, reason] of [
      [{ schema: 2 }, 'request-schema'],
      [{ resultsDir: 'relative/results' }, 'request-results-dir'],
      [{ sha: 'HEAD' }, 'request-sha'],
      [{ checks: 'selftest.complete' }, 'request-checks'],
      [{ budgetSeconds: 0 }, 'request-budget'],
      [{ deadline: 1_800_000_000 }, 'request-deadline'],
      [{ deadline: '2026-10-13 12:00:00' }, 'request-deadline'],
      [{ deadline: '2026-13-13T12:00:00Z' }, 'request-deadline'],
      [{ deadline: '2026-02-30T12:00:00Z' }, 'request-deadline'],
      [{ profiles: [1] }, 'request-profiles'],
      [{ payloads: { retroarch: 7 } }, 'request-payloads'],
      [{ savingPayloads: 'retroarch' }, 'request-saving-payloads'],
      [{ version: 21 }, 'request-version'],
      [{ version: '0.21.0 at owners-server.example' }, 'request-version']
    ] as const) {
      const taken = parseRequest(rawRequest(overrides))
      assert.equal(taken.kind, 'refused')
      assert.equal(taken.reason, reason)
    }
    assert.equal(parseRequest(null).kind, 'refused')
  })

  test('a refusal is reported where the harness looks, as a valid error summary', () => {
    const results = join(scratch(), 'results')
    const taken = parseRequest(rawRequest({ resultsDir: results, privacy: false }))
    assert.equal(taken.kind, 'refused')
    reportRefusal(taken, '0.21.0', Date.UTC(2026, 9, 12))
    const summary = JSON.parse(readFileSync(join(results, SUMMARY_FILE), 'utf8')) as Summary
    assert.deepEqual(summaryErrors(summary), [])
    assert.equal(summary.status, 'error')
    assert.equal(summary.reason, 'request-not-private')
    assert.equal(summary.sha, SHA)
  })
})

describe('the run', () => {
  test('runs each requested scenario and answers the run checks itself', async () => {
    const guard = new ReadOnlyGuard()
    const summary = await runSelfTest({
      request: request({ checks: ['startup.cold', 'selftest.complete'] }),
      scenarios: new Map<string, Scenario>([['startup.cold', async () => pass('startup.cold')]]),
      guard,
      version: '0.21.0'
    })
    assert.deepEqual(summaryErrors(summary), [])
    assert.equal(summary.status, 'complete')
    const checks = byId(summary)
    assert.equal(checks.get('startup.cold')?.result, 'pass')
    assert.equal(checks.get(RUN_CHECKS.complete)?.result, 'pass')
    assert.equal(checks.get(RUN_CHECKS.serverReadOnly)?.result, 'pass')
  })

  test('a scenario may answer once per profile', async () => {
    const summary = await runSelfTest({
      request: request({ checks: ['grid.scroll'] }),
      scenarios: new Map<string, Scenario>([
        [
          'grid.scroll',
          async (context) => context.request.profiles.map((p) => pass(`grid.scroll@${p}`))
        ]
      ]),
      guard: new ReadOnlyGuard(),
      version: '0.21.0'
    })
    assert.deepEqual(summaryErrors(summary), [])
    assert.deepEqual(
      summary.checks.map((c) => c.id),
      ['grid.scroll@performance', 'grid.scroll@balanced', RUN_CHECKS.serverReadOnly]
    )
  })

  test('a scenario that throws is an error, the run goes on, and the summary is partial', async () => {
    const summary = await runSelfTest({
      request: request({ checks: ['startup.cold', 'memory.resident', 'selftest.complete'] }),
      scenarios: new Map<string, Scenario>([
        [
          'startup.cold',
          async () => {
            throw new Error('http://owners-server.example/ broke')
          }
        ],
        ['memory.resident', async () => pass('memory.resident')]
      ]),
      guard: new ReadOnlyGuard(),
      version: '0.21.0'
    })
    assert.deepEqual(summaryErrors(summary), [])
    assert.equal(summary.status, 'partial')
    const checks = byId(summary)
    assert.equal(checks.get('startup.cold')?.result, 'error')
    assert.equal(checks.get('memory.resident')?.result, 'pass')
    assert.equal(checks.get(RUN_CHECKS.complete)?.result, 'fail')
    // The thrown message can name the server; the summary is published.
    assert.ok(!JSON.stringify(summary).includes('owners-server'))
  })

  test('a check this build has no scenario for is a skip, and the run is not complete', async () => {
    const summary = await runSelfTest({
      request: request({ checks: ['launch.retroarch', 'selftest.complete'] }),
      scenarios: new Map(),
      guard: new ReadOnlyGuard(),
      version: '0.21.0'
    })
    const checks = byId(summary)
    assert.equal(checks.get('launch.retroarch')?.result, 'skip')
    assert.equal(checks.get('launch.retroarch')?.reason, SKIP.notImplemented)
    assert.equal(summary.status, 'partial')
    assert.equal(checks.get(RUN_CHECKS.complete)?.result, 'fail')
  })

  test('the budget ends the run: the rest are skipped and the summary is partial', async () => {
    let clock = 0
    const summary = await runSelfTest({
      request: request({ budgetSeconds: 10, checks: ['startup.cold', 'memory.resident'] }),
      scenarios: new Map<string, Scenario>([
        [
          'startup.cold',
          async () => {
            clock += 11_000
            return pass('startup.cold')
          }
        ],
        ['memory.resident', async () => assert.fail('ran past the budget')]
      ]),
      guard: new ReadOnlyGuard(),
      version: '0.21.0',
      now: () => clock
    })
    assert.equal(summary.status, 'partial')
    assert.equal(byId(summary).get('memory.resident')?.reason, SKIP.budget)
  })

  test('the deadline ends the run when it comes before the budget does', async () => {
    let clock = Date.UTC(2026, 9, 13, 12, 0, 0)
    const summary = await runSelfTest({
      request: request({
        budgetSeconds: 600,
        deadline: '2026-10-13T12:00:10Z',
        checks: ['startup.cold', 'memory.resident']
      }),
      scenarios: new Map<string, Scenario>([
        [
          'startup.cold',
          async () => {
            clock += 11_000
            return pass('startup.cold')
          }
        ],
        ['memory.resident', async () => assert.fail('ran past the deadline')]
      ]),
      guard: new ReadOnlyGuard(),
      version: '0.21.0',
      now: () => clock
    })
    assert.equal(summary.status, 'partial')
    assert.equal(byId(summary).get('memory.resident')?.reason, SKIP.budget)
  })

  test('a deadline after the budget ends changes nothing', async () => {
    let clock = Date.UTC(2026, 9, 13, 12, 0, 0)
    const summary = await runSelfTest({
      request: request({
        budgetSeconds: 10,
        deadline: '2026-10-13T13:00:00Z',
        checks: ['startup.cold', 'memory.resident']
      }),
      scenarios: new Map<string, Scenario>([
        [
          'startup.cold',
          async () => {
            clock += 11_000
            return pass('startup.cold')
          }
        ],
        ['memory.resident', async () => assert.fail('ran past the budget')]
      ]),
      guard: new ReadOnlyGuard(),
      version: '0.21.0',
      now: () => clock
    })
    assert.equal(byId(summary).get('memory.resident')?.reason, SKIP.budget)
  })

  test('input from the controller stops the run as aborted-by-user', async () => {
    const abort = new AbortController()
    const summary = await runSelfTest({
      request: request({ checks: ['startup.cold', 'memory.resident'] }),
      scenarios: new Map<string, Scenario>([
        [
          'startup.cold',
          async () => {
            abort.abort()
            return pass('startup.cold')
          }
        ],
        ['memory.resident', async () => assert.fail('ran after the abort')]
      ]),
      guard: new ReadOnlyGuard(),
      version: '0.21.0',
      signal: abort.signal
    })
    assert.deepEqual(summaryErrors(summary), [])
    assert.equal(summary.status, 'aborted-by-user')
    assert.equal(byId(summary).get('memory.resident')?.reason, SKIP.aborted)
  })

  test("the screenshots are taken after the checks and are selftest.complete's evidence", async () => {
    const order: string[] = []
    const summary = await runSelfTest({
      request: request({
        checks: ['selftest.complete', 'startup.cold'],
        screenshots: ['settings', 'home', 'settings']
      }),
      scenarios: new Map<string, Scenario>([
        [
          'startup.cold',
          async () => {
            order.push('startup.cold')
            return pass('startup.cold')
          }
        ]
      ]),
      screenshots: async (screens) => {
        order.push(`shots:${screens.join(',')}`)
        return { evidence: ['shots/settings.png'], missing: [], withheld: ['home'] }
      },
      guard: new ReadOnlyGuard(),
      version: '0.21.0'
    })
    assert.deepEqual(summaryErrors(summary), [])
    assert.deepEqual(order, ['startup.cold', 'shots:settings,home'])
    assert.equal(summary.status, 'complete')
    const complete = byId(summary).get(RUN_CHECKS.complete)
    assert.equal(complete?.result, 'pass')
    assert.deepEqual(complete?.evidence, ['shots/settings.png'])
    assert.equal(complete?.metrics.screenshots, 1)
    assert.equal(complete?.metrics.screenshotsWithheld, 1)
    assert.deepEqual(summary.notes, [])
  })

  test('a screen without a shot fails selftest.complete and is named in the notes', async () => {
    const summary = await runSelfTest({
      request: request({ checks: ['selftest.complete'], screenshots: ['bios'] }),
      scenarios: new Map(),
      screenshots: async () => ({
        evidence: [],
        missing: ['bios:screen-not-reached'],
        withheld: []
      }),
      guard: new ReadOnlyGuard(),
      version: '0.21.0'
    })
    assert.deepEqual(summaryErrors(summary), [])
    // The run itself was whole; the screen is what failed.
    assert.equal(summary.status, 'complete')
    const complete = byId(summary).get(RUN_CHECKS.complete)
    assert.equal(complete?.result, 'fail')
    assert.equal(complete?.reason, 'screenshots-missing')
    assert.equal(complete?.metrics.screenshotsMissing, 1)
    assert.deepEqual(summary.notes, ['screenshot bios:screen-not-reached'])
  })

  test('screenshots this build cannot take, or a capture that throws, leave the run partial', async () => {
    const without = await runSelfTest({
      request: request({ checks: ['selftest.complete'], screenshots: ['settings'] }),
      scenarios: new Map(),
      guard: new ReadOnlyGuard(),
      version: '0.21.0'
    })
    assert.equal(without.status, 'partial')
    assert.deepEqual(without.notes, [`screenshot settings:${SKIP.notImplemented}`])
    assert.equal(byId(without).get(RUN_CHECKS.complete)?.result, 'fail')

    const threw = await runSelfTest({
      request: request({ checks: ['selftest.complete'], screenshots: ['settings'] }),
      scenarios: new Map(),
      screenshots: async () => assert.fail('capture broke'),
      guard: new ReadOnlyGuard(),
      version: '0.21.0'
    })
    assert.deepEqual(summaryErrors(threw), [])
    assert.equal(threw.status, 'partial')
    assert.deepEqual(threw.notes, ['screenshot settings:screenshots-threw'])
  })

  test('no screenshots are taken once the run is aborted or out of budget', async () => {
    const abort = new AbortController()
    abort.abort()
    const aborted = await runSelfTest({
      request: request({ checks: [], screenshots: ['settings'] }),
      scenarios: new Map(),
      screenshots: async () => assert.fail('captured after the abort'),
      guard: new ReadOnlyGuard(),
      version: '0.21.0',
      signal: abort.signal
    })
    assert.equal(aborted.status, 'aborted-by-user')
    assert.ok(aborted.notes.includes(`screenshot settings:${SKIP.aborted}`))

    let clock = 0
    const late = await runSelfTest({
      request: request({ checks: ['startup.cold'], screenshots: ['settings'], budgetSeconds: 1 }),
      scenarios: new Map<string, Scenario>([
        [
          'startup.cold',
          async () => {
            clock += 2000
            return pass('startup.cold')
          }
        ]
      ]),
      screenshots: async () => assert.fail('captured over budget'),
      guard: new ReadOnlyGuard(),
      version: '0.21.0',
      now: () => clock
    })
    assert.equal(late.status, 'partial')
    assert.deepEqual(late.notes, [`screenshot settings:${SKIP.budget}`])
  })

  test('a write the guard refused fails safety.server-readonly, requested or not', async () => {
    const guard = new ReadOnlyGuard()
    const summary = await runSelfTest({
      request: request({ checks: ['startup.cold'] }),
      scenarios: new Map<string, Scenario>([
        [
          'startup.cold',
          async () => {
            assert.throws(() => guard.admit('POST', '/api/saves'))
            guard.admit('GET', '/api/saves?rom_id=1&device_id=owners')
            return pass('startup.cold')
          }
        ]
      ]),
      guard,
      version: '0.21.0'
    })
    const readOnly = byId(summary).get(RUN_CHECKS.serverReadOnly)
    assert.equal(readOnly?.result, 'fail')
    assert.equal(readOnly?.metrics.serverWritesAttempted, 1)
    assert.equal(readOnly?.metrics.deviceIdsRemoved, 1)
    assert.equal(summary.safety.serverWritesAttempted, 1)
    assert.equal(summary.safety.deviceIdOnSaveRequests, 0)
  })
})

describe('reporting', () => {
  test('the summary is written whole, and the app quits with 0', async () => {
    const results = join(scratch(), 'results')
    const code = await runAndReport({
      request: request({ resultsDir: results }),
      scenarios: new Map(),
      guard: new ReadOnlyGuard(),
      version: '0.21.0'
    })
    assert.equal(code, 0)
    assert.deepEqual(readdirSync(results), [SUMMARY_FILE])
    assert.deepEqual(
      summaryErrors(JSON.parse(readFileSync(join(results, SUMMARY_FILE), 'utf8'))),
      []
    )
  })

  test('a runner that throws still leaves an error summary', async () => {
    const results = join(scratch(), 'results')
    const code = await runAndReport({
      request: request({ resultsDir: results }),
      scenarios: new Map(),
      // A guard whose count cannot be read stands for a fault in the runner itself.
      guard: Object.defineProperty(new ReadOnlyGuard(), 'serverWritesAttempted', {
        get() {
          throw new Error('broken')
        }
      }),
      version: '0.21.0'
    })
    assert.equal(code, 1)
    const summary = JSON.parse(readFileSync(join(results, SUMMARY_FILE), 'utf8')) as Summary
    assert.deepEqual(summaryErrors(summary), [])
    assert.equal(summary.status, 'error')
    assert.equal(summary.reason, 'runner-threw')
  })
})

describe('the summary schema', () => {
  test('the example in docs/TESTING.md passes', () => {
    assert.deepEqual(summaryErrors(documentedSummary()), [])
  })

  test('departures are named', () => {
    const good = documentedSummary() as Record<string, unknown>
    const check = (good.checks as Record<string, unknown>[])[0]
    const cases: [Record<string, unknown>, string][] = [
      [{ ...good, schema: 2 }, 'schema'],
      [{ ...good, sha: 'abc' }, 'sha'],
      [{ ...good, status: 'done' }, 'status'],
      [{ ...good, startedAt: 'yesterday' }, 'startedAt'],
      [{ ...good, safety: { ...(good.safety as object), romsLeft: -1 } }, 'safety.romsLeft'],
      [{ ...good, notes: 'none' }, 'notes'],
      [{ ...good, checks: [{ ...check, id: 'Grid Scroll' }] }, 'checks[0].id'],
      [{ ...good, checks: [{ ...check, result: 'ok' }] }, 'checks[0].result'],
      [{ ...good, checks: [{ ...check, metrics: { p95Ms: Infinity } }] }, 'checks[0].metrics'],
      [
        { ...good, checks: [{ ...check, result: 'skip', reason: null }] },
        'checks[0].reason (a skip says why)'
      ],
      [{ ...good, checks: [{ ...check, evidence: ['/etc/passwd'] }] }, 'checks[0].evidence'],
      [{ ...good, checks: [{ ...check, evidence: ['../outside'] }] }, 'checks[0].evidence']
    ]
    for (const [summary, error] of cases) assert.deepEqual(summaryErrors(summary), [error])
  })
})
