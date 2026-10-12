import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { electronBinary, seed, startApp } from './driver.ts'
import { GBA_ROM, startFakeRomm } from './server.ts'
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

async function runWithRequest(
  request: Record<string, unknown>,
  server?: { baseUrl: string; token: string }
): Promise<{
  code: number | null
  home: string
  results: string
}> {
  const home = mkdtempSync(join(tmpdir(), 'galleon-selftest-app-'))
  homes.push(home)
  const results = join(home, 'results')
  if (server) seed(home, { baseUrl: server.baseUrl, token: server.token })
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
  checks: [RUN_CHECKS.complete, 'grid.scroll'],
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
  // `grid.scroll` has no scenario in this build, so not every check ran.
  assert.equal(summary.status, 'partial')
  assert.equal(summary.safety.serverWritesAttempted, 0)
  const checks = new Map(summary.checks.map((c) => [c.id, c]))
  assert.equal(checks.get(RUN_CHECKS.serverReadOnly)?.result, 'pass')
  assert.equal(checks.get('grid.scroll')?.reason, 'not-implemented')
  assert.ok(checks.has(RUN_CHECKS.complete))
})

test('signed in, startup.cold times the start to an interactive Home', async () => {
  const server = await startFakeRomm()
  try {
    const { code, results } = await runWithRequest(
      { ...REQUEST, checks: [RUN_CHECKS.complete, 'startup.cold'] },
      server
    )
    assert.equal(code, 0)
    const summary = JSON.parse(readFileSync(join(results, SUMMARY_FILE), 'utf8')) as Summary
    assert.deepEqual(summaryErrors(summary), [])
    assert.equal(summary.status, 'complete')
    const startup = summary.checks.find((c) => c.id === 'startup.cold')
    // Pass or fail is the device's to say: a CI runner is not the Nova.
    assert.ok(startup && startup.result !== 'error', JSON.stringify(startup))
    assert.notEqual(startup.reason, 'home-not-reached')
    assert.equal(startup.metrics.measuredFrom, 'process')
    assert.ok(typeof startup.metrics.startupMs === 'number' && startup.metrics.startupMs > 0)
    assert.equal(summary.checks.find((c) => c.id === RUN_CHECKS.complete)?.result, 'pass')
  } finally {
    await server.close()
  }
})

test('a request without privacy is refused with an error summary and exit 1', async () => {
  const { code, results } = await runWithRequest({ ...REQUEST, privacy: false })
  assert.equal(code, 1)
  const summary = JSON.parse(readFileSync(join(results, SUMMARY_FILE), 'utf8')) as Summary
  assert.deepEqual(summaryErrors(summary), [])
  assert.equal(summary.status, 'error')
  assert.equal(summary.reason, 'request-not-private')
})

test('signed in, server.heartbeat reads the server and nothing but reads reach it', async () => {
  const server = await startFakeRomm()
  try {
    const { code, results } = await runWithRequest(
      { ...REQUEST, checks: [RUN_CHECKS.complete, 'server.heartbeat'] },
      server
    )
    assert.equal(code, 0)
    const summary = JSON.parse(readFileSync(join(results, SUMMARY_FILE), 'utf8')) as Summary
    assert.deepEqual(summaryErrors(summary), [])
    assert.equal(summary.status, 'complete')
    const checks = new Map(summary.checks.map((c) => [c.id, c]))
    assert.equal(checks.get('server.heartbeat')?.result, 'pass')
    assert.equal(checks.get(RUN_CHECKS.complete)?.result, 'pass')
    assert.equal(checks.get(RUN_CHECKS.serverReadOnly)?.result, 'pass')
    const paths = server.asked.map((a) => a.path.split('?')[0])
    assert.ok(paths.includes('/api/heartbeat'))
    assert.ok(paths.includes('/api/users/me'))
    assert.deepEqual(
      server.asked.filter((a) => a.method !== 'GET' && a.method !== 'HEAD'),
      []
    )
    assert.ok(!JSON.stringify(summary).includes(new URL(server.baseUrl).host))
  } finally {
    await server.close()
  }
})

test('download.small fetches the GBA game into the test home, verifies it and removes it', async () => {
  const server = await startFakeRomm({ gba: true })
  try {
    const { code, home, results } = await runWithRequest(
      { ...REQUEST, checks: [RUN_CHECKS.complete, 'download.small'] },
      server
    )
    assert.equal(code, 0)
    const summary = JSON.parse(readFileSync(join(results, SUMMARY_FILE), 'utf8')) as Summary
    assert.deepEqual(summaryErrors(summary), [])
    const check = summary.checks.find((c) => c.id === 'download.small')
    assert.equal(check?.result, 'pass', String(check?.reason))
    assert.ok((check?.metrics.progressEvents as number) > 0)
    assert.equal(summary.status, 'complete')
    assert.ok(summary.safety.romsDownloadedBytes > 0)
    assert.equal(summary.safety.romsLeft, 0)
    const paths = server.asked.map((a) => a.path.split('?')[0])
    assert.ok(paths.some((path) => path.startsWith(`/api/roms/${GBA_ROM}/content`)))
    assert.deepEqual(
      server.asked.filter((a) => a.method !== 'GET' && a.method !== 'HEAD'),
      []
    )
    assert.deepEqual(gamesUnder(home), [])
  } finally {
    await server.close()
  }
})

/** Every file under the home with the downloaded game's name. */
function gamesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((name) =>
    name.includes('pockethomebrew')
  )
}

test('a press on the controller stops the run within a second, as aborted-by-user', async () => {
  const home = mkdtempSync(join(tmpdir(), 'galleon-selftest-abort-'))
  homes.push(home)
  const results = join(home, 'results')
  // Signed out, so Home never comes and `startup.cold` is still waiting when
  // the press arrives.
  const app = await startApp({
    baseUrl: 'http://127.0.0.1:9',
    token: 'unused',
    signedOut: true,
    home,
    files: {
      [REQUEST_FILE]: JSON.stringify({
        ...REQUEST,
        checks: [RUN_CHECKS.complete, 'startup.cold'],
        resultsDir: results
      })
    }
  })
  try {
    const pad = await app.plugInPad()
    const pressed = Date.now()
    // The app may quit before the press has been answered.
    await pad.hold(0).catch(() => undefined)
    const summaryPath = join(results, SUMMARY_FILE)
    while (!existsSync(summaryPath) && Date.now() - pressed < EXIT_TIMEOUT_MS) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    const tookMs = Date.now() - pressed
    assert.ok(existsSync(summaryPath), 'a summary is written')
    assert.ok(tookMs < 1_000, `the run stopped ${tookMs} ms after the press`)
    const summary = JSON.parse(readFileSync(summaryPath, 'utf8')) as Summary
    assert.deepEqual(summaryErrors(summary), [])
    assert.equal(summary.status, 'aborted-by-user')
    const startup = summary.checks.find((c) => c.id === 'startup.cold')
    assert.equal(startup?.result, 'skip')
    assert.equal(startup?.reason, 'aborted-by-user')
  } finally {
    await app.stop()
  }
})
