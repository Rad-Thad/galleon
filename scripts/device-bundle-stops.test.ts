import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import {
  SHA,
  built,
  unpackLikeTheBridge,
  fakeSession,
  withShortcut,
  runHarness,
  running,
  answersOnceServer
} from './device-bundle-harness.ts'

/**
 * run.sh's starts and stops that come late or not at all. Each waits out one
 * of run.sh's own timeouts, which count in whole seconds, so this file is apart
 * from device-bundle.test.ts and the test runner runs the two side by side.
 */
describe('device-bundle: late starts and stops', () => {
  test('run.sh stops a start it gave up on that happens before the request is withdrawn', () => {
    const session = fakeSession()
    // Steam starts the shortcut only after run.sh stops waiting for it, and
    // the debugger cannot be asked, so the start is given up on.
    writeFileSync(join(session, 'steam.late'), '0.5')
    const seen = mkdtempSync(join(tmpdir(), 'bundle-seen-'))
    const cef = answersOnceServer()
    const app =
      '#!/bin/sh\n' +
      `[ -e '${join(session, 'muted')}' ] || echo unmuted >>'${join(seen, 'sound')}'\n` +
      `echo $$ >'${join(seen, 'pid')}'\n` +
      'while :; do sleep 0.2; done\n'
    const { run, results } = runHarness(
      unpackLikeTheBridge(built()),
      SHA,
      app,
      {
        GALLEON_START_WAIT_SECONDS: '0',
        // A debugger that answers the check before the start and then
        // nothing for a while, so the late start lands after run.sh gave up
        // and before it withdraws the request.
        GALLEON_STEAM_CEF: `http://127.0.0.1:${cef.port}`,
        // The same debugger cannot show Steam's screen; nothing waits on it.
        GALLEON_LIBRARY_WAIT_SECONDS: '0',
        HOME: withShortcut(mkdtempSync(join(tmpdir(), 'bundle-home-')))
      },
      session
    )
    cef.server.kill()
    assert.equal(run.status, 0, run.stderr)
    const summary = JSON.parse(readFileSync(join(results, 'summary.json'), 'utf8'))
    assert.equal(summary.checks[0].reason, 'neither route started the app')
    assert.ok(
      summary.notes.some((note: string) => note.startsWith('app: started late, ')),
      summary.notes.join('; ')
    )
    assert.ok(!existsSync(join(seen, 'sound')), 'the app never ran with the sound on')
    const pid = Number(readFileSync(join(seen, 'pid'), 'utf8'))
    assert.ok(!running(pid), `pid ${pid} still runs`)
  })

  test('a start Steam acts on after the run withdrew its request starts nothing', () => {
    const session = fakeSession()
    writeFileSync(join(session, 'steam.late'), '6')
    const seen = mkdtempSync(join(tmpdir(), 'bundle-seen-'))
    const app = `#!/bin/sh\necho ran >'${join(seen, 'ran')}'\n`
    const { run, results, testDir } = runHarness(
      unpackLikeTheBridge(built()),
      SHA,
      app,
      { GALLEON_START_WAIT_SECONDS: '1' },
      session
    )
    assert.equal(run.status, 0, run.stderr)
    const summary = JSON.parse(readFileSync(join(results, 'summary.json'), 'utf8'))
    assert.ok(summary.notes.includes('app: not started'), summary.notes.join('; '))
    // The late start comes after run.sh has finished.
    execFileSync('sleep', ['7'])
    assert.ok(!existsSync(join(seen, 'ran')))
    assert.ok(!existsSync(join(testDir, 'home/launch/started')))
  })

  test('run.sh asks an app past its budget to stop, then signals only the pids launch.sh recorded', () => {
    const seen = mkdtempSync(join(tmpdir(), 'bundle-seen-'))
    // An app that runs on until it is signalled, and says what stopped it.
    const app =
      '#!/bin/sh\n' +
      `trap 'echo term >"${join(seen, 'signal')}"; exit 0' TERM\n` +
      'while :; do sleep 0.2; done\n'
    // The app's budget is the bridge's less the stop reserve, so this one
    // leaves it a few seconds.
    const { run, results, testDir } = runHarness(unpackLikeTheBridge(built()), SHA, app, {
      DEVICE_TEST_BUDGET_SECONDS: '124',
      GALLEON_STOP_WAIT_SECONDS: '2'
    })
    assert.equal(run.status, 0, run.stderr)
    const summary = JSON.parse(readFileSync(join(results, 'summary.json'), 'utf8'))
    assert.ok(summary.notes.includes('app: stopped by a signal'), summary.notes.join('; '))
    assert.deepEqual([summary.status, summary.reason], ['partial', null])
    assert.ok(existsSync(join(testDir, 'handshake/stop')))
    assert.equal(readFileSync(join(seen, 'signal'), 'utf8'), 'term\n')
    assert.equal(readFileSync(join(testDir, 'home/launch/exit'), 'utf8'), '0\n')
  })

  test('run.sh kills an app that ignores the stop, by its recorded pid', () => {
    const app = "#!/bin/sh\ntrap '' TERM\nwhile :; do sleep 0.2; done\n"
    const { run, results, testDir } = runHarness(unpackLikeTheBridge(built()), SHA, app, {
      DEVICE_TEST_BUDGET_SECONDS: '124',
      GALLEON_STOP_WAIT_SECONDS: '2'
    })
    assert.equal(run.status, 0, run.stderr)
    const summary = JSON.parse(readFileSync(join(results, 'summary.json'), 'utf8'))
    assert.ok(summary.notes.includes('app: killed'), summary.notes.join('; '))
    assert.deepEqual([summary.status, summary.reason], ['partial', null])
    const pid = Number(readFileSync(join(testDir, 'home/launch/app.pid'), 'utf8'))
    assert.ok(!running(pid), `pid ${pid} still runs`)
  })
})
