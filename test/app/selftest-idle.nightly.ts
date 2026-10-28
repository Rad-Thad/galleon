import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { startFakeRomm } from './server.ts'
import { EXIT_TIMEOUT_MS, REQUEST, armada, runWithRequest } from './selftestrun.ts'
import { SUMMARY_FILE, summaryErrors, type Summary } from '../../src/main/selftest.ts'
import { IDLE_CHECK, IDLE_MS, SETTLE_MS } from '../../src/main/selftestidle.ts'
import { PROFILE_SET, WANT_PROFILE } from '../../src/main/selftestscroll.ts'

/**
 * `idle.cpu` end to end in the built app, as run.sh asks for it on the Nova:
 * a fake Armada switched to Balanced through the handshake, the minute on
 * Home counted from /proc, and the press on the page's own pad timed while the
 * abort watch runs. Nightly, since the check waits out its own minute
 * (PLAN.md section 4).
 */

test('idle.cpu measures a minute on Balanced and times the press after it, without aborting', async () => {
  const server = await startFakeRomm()
  const machine = armada()
  machine.setProfile('performance')
  const handshake = join(machine.root, 'handshake')
  mkdirSync(handshake)
  const asked: string[] = []
  const answering = setInterval(() => {
    const want = join(handshake, WANT_PROFILE)
    if (!existsSync(want) || existsSync(join(handshake, PROFILE_SET))) return
    const name = readFileSync(want, 'utf8').trim()
    asked.push(name)
    machine.setProfile(name)
    writeFileSync(join(handshake, PROFILE_SET), `${name}\n`)
  }, 50)
  try {
    const { code, results } = await runWithRequest(
      { ...REQUEST, checks: [IDLE_CHECK], handshakeDir: handshake, abortOnInput: true },
      server,
      EXIT_TIMEOUT_MS + SETTLE_MS + IDLE_MS,
      {
        GALLEON_POWER_ROOT: machine.root,
        PATH: `${machine.bin}:${process.env.PATH ?? ''}`
      }
    )
    assert.equal(code, 0)
    const summary = JSON.parse(readFileSync(join(results, SUMMARY_FILE), 'utf8')) as Summary
    assert.deepEqual(summaryErrors(summary), [])
    // The self-test's own pad is the run pressing, not a person.
    assert.notEqual(summary.status, 'aborted-by-user')
    assert.deepEqual(asked, ['balanced'])
    const check = summary.checks.find((c) => c.id === IDLE_CHECK)
    assert.equal(check?.result, 'pass', JSON.stringify(check))
    console.log(`idle.cpu: ${JSON.stringify(check.metrics)}`)
    assert.equal(check.metrics.profileObserved, 'balanced')
    assert.equal(check.metrics.governor, 'conservative')
    for (const metric of ['cpuSeconds', 'cpuTabS', 'cpuBrowserS', 'latencyMs', 'frameMs'])
      assert.equal(typeof check.metrics[metric], 'number', metric)
  } finally {
    clearInterval(answering)
    await server.close()
  }
})
