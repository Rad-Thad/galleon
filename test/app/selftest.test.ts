import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { electronBinary } from './driver.ts'
import {
  REQUEST_FILE,
  RUN_CHECKS,
  SUMMARY_FILE,
  TAKEN_FILE,
  summaryErrors,
  type Summary
} from '../../src/main/selftest.ts'

/**
 * The built app given a self-test request, as run.sh gives it on the Nova:
 * it takes the request, writes `summary.json` and quits on its own, without
 * anyone driving it. The scenarios themselves are unit-tested; this proves the
 * start-up path that reaches them, and the exit code the harness reads.
 */

/** Start-up, the run and the quit together, on a slow CI runner. */
const EXIT_TIMEOUT_MS = 60_000

const homes: string[] = []
after(() => {
  for (const home of homes) rmSync(home, { recursive: true, force: true })
})

async function runWithRequest(request: Record<string, unknown>): Promise<{
  code: number | null
  home: string
  results: string
}> {
  const home = mkdtempSync(join(tmpdir(), 'galleon-selftest-app-'))
  homes.push(home)
  const results = join(home, 'results')
  writeFileSync(join(home, REQUEST_FILE), JSON.stringify({ ...request, resultsDir: results }))
  const child = spawn(electronBinary(), ['.'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GALLEON_HOME: home,
      XDG_CONFIG_HOME: join(home, 'xdg-config'),
      FLATPAK_SYSTEM_DIR: join(home, 'flatpak-system'),
      FLATPAK_USER_DIR: join(home, 'flatpak-user')
    }
  })
  let output = ''
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()))
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()))
  const code = await new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`the self-test never quit:\n${output}`))
    }, EXIT_TIMEOUT_MS)
    child.on('exit', (exitCode) => {
      clearTimeout(timer)
      resolve(exitCode)
    })
  })
  return { code, home, results }
}

const REQUEST = {
  schema: 1,
  sha: 'b'.repeat(40),
  budgetSeconds: 600,
  handshakeDir: null,
  checks: [RUN_CHECKS.complete, 'startup.cold'],
  profiles: ['performance'],
  payloads: {},
  fakeRomm: null,
  readOnlyServer: true,
  privacy: true,
  abortOnInput: true,
  screenshots: []
}

test('a self-test request is taken, answered in summary.json, and the app quits with 0', async () => {
  const { code, home, results } = await runWithRequest(REQUEST)
  assert.equal(code, 0)
  assert.ok(!existsSync(join(home, REQUEST_FILE)), 'the request is taken')
  assert.ok(existsSync(join(home, TAKEN_FILE)))
  const summary = JSON.parse(readFileSync(join(results, SUMMARY_FILE), 'utf8')) as Summary
  assert.deepEqual(summaryErrors(summary), [])
  assert.equal(summary.sha, REQUEST.sha)
  // `startup.cold` has no scenario in this build, so not every check ran.
  assert.equal(summary.status, 'partial')
  assert.equal(summary.safety.serverWritesAttempted, 0)
  const checks = new Map(summary.checks.map((c) => [c.id, c]))
  assert.equal(checks.get(RUN_CHECKS.serverReadOnly)?.result, 'pass')
  assert.ok(checks.has('startup.cold'))
  assert.ok(checks.has(RUN_CHECKS.complete))
})

test('a request without privacy is refused with an error summary and exit 1', async () => {
  const { code, results } = await runWithRequest({ ...REQUEST, privacy: false })
  assert.equal(code, 1)
  const summary = JSON.parse(readFileSync(join(results, SUMMARY_FILE), 'utf8')) as Summary
  assert.deepEqual(summaryErrors(summary), [])
  assert.equal(summary.status, 'error')
  assert.equal(summary.reason, 'request-not-private')
})
