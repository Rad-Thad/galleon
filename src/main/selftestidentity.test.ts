import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { ReadOnlyGuard } from './romm/guard.ts'
import { IDENTITY_CHECK, identityScenario, type Identity } from './selftestidentity.ts'
import { parseRequest, runSelfTest, summaryErrors, type CheckResult } from './selftest.ts'

/**
 * `build.identity` on the device: the app the harness started reports the
 * commit and version the nightly's `build-info.json` names.
 */

const SHA = 'c'.repeat(40)

function request(overrides: Record<string, unknown> = {}) {
  const taken = parseRequest({
    schema: 1,
    sha: SHA,
    version: '0.21.0',
    budgetSeconds: 60,
    resultsDir: '/tmp/results',
    checks: [IDENTITY_CHECK],
    readOnlyServer: true,
    privacy: true,
    ...overrides
  })
  assert.equal(taken.kind, 'request')
  return taken.request
}

async function check(running: Identity, overrides: Record<string, unknown> = {}) {
  const answered = await identityScenario(running)({
    request: request(overrides),
    safety: {} as never,
    signal: new AbortController().signal
  })
  assert.ok(!Array.isArray(answered))
  return answered
}

describe('build.identity', () => {
  test('passes when the commit and the version are the ones build-info.json names', async () => {
    const result = await check({ version: '0.21.0', commit: SHA })
    assert.equal(result.result, 'pass')
    assert.equal(result.reason, null)
    assert.deepEqual(result.metrics, {
      version: '0.21.0',
      commit: SHA,
      expectedVersion: '0.21.0',
      expectedCommit: SHA
    })
  })

  test('another commit fails, whatever the version', async () => {
    const result = await check({ version: '0.21.0', commit: 'd'.repeat(40) })
    assert.equal(result.result, 'fail')
    assert.equal(result.reason, 'commit-mismatch')
  })

  test('a build over local changes is not the commit it names', async () => {
    const result = await check({ version: '0.21.0', commit: `${SHA}-dirty` })
    assert.equal(result.result, 'fail')
    assert.equal(result.reason, 'commit-mismatch')
  })

  test('a build with no commit stamped fails', async () => {
    const result = await check({ version: '0.21.0', commit: '' })
    assert.equal(result.result, 'fail')
    assert.equal(result.reason, 'commit-unstamped')
    assert.equal(result.metrics.commit, null)
  })

  test('another version fails', async () => {
    const result = await check({ version: '0.20.0', commit: SHA })
    assert.equal(result.result, 'fail')
    assert.equal(result.reason, 'version-mismatch')
  })

  test('a request without a version is a skip, not a pass on the commit alone', async () => {
    const result = await check({ version: '0.21.0', commit: SHA }, { version: undefined })
    assert.equal(result.result, 'skip')
    assert.equal(result.reason, 'no-build-version')
  })

  test('its result makes a valid summary', async () => {
    const summary = await runSelfTest({
      request: request(),
      scenarios: new Map([[IDENTITY_CHECK, identityScenario({ version: '0.21.0', commit: SHA })]]),
      guard: new ReadOnlyGuard(),
      version: '0.21.0'
    })
    assert.deepEqual(summaryErrors(summary), [])
    const identity = summary.checks.find((c: CheckResult) => c.id === IDENTITY_CHECK)
    assert.equal(identity?.result, 'pass')
  })
})
