import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import {
  ROOT,
  SHA,
  VERSION,
  TARGET_GAMEID,
  built,
  unpackLikeTheBridge,
  fakeSession,
  runHarness
} from './device-bundle-harness.ts'

/**
 * An app that does steam.launch's handshake as selfteststeam.ts does: it asks
 * Steam for its request's target, marks `steam-launched`, and keeps in `seen`
 * what run.sh answered and whether the target had started by then. With a
 * `reason` (null for none) it then writes a summary holding steam.launch
 * with that reason; without one it quits without a summary, as a Galleon Steam closed would.
 */
function steamLaunchingApp(seen: string, reason?: string | null) {
  const summary = JSON.stringify({
    schema: 1,
    sha: SHA,
    version: VERSION,
    status: 'complete',
    reason: null,
    checks: [
      {
        id: 'steam.launch',
        result: reason === 'needs-attended' ? 'skip' : 'pass',
        metrics: { prompt: reason === 'needs-attended' ? 'left' : 'none' },
        thresholds: {},
        reason: reason ?? null,
        evidence: []
      }
    ],
    notes: []
  })
  return (
    '#!/bin/sh\n' +
    "exec python3 -I -c 'import json, os, subprocess, sys, time\n" +
    'home = os.environ["GALLEON_HOME"]\n' +
    'request = json.load(open(os.path.join(home, "self-test-request.json")))\n' +
    'hs = request["handshakeDir"]\n' +
    'target = request.get("steamTarget")\n' +
    'seen = {"checks": request["checks"], "steamTarget": target}\n' +
    'if target:\n' +
    '    subprocess.run(["steam", "steam://rungameid/" + target])\n' +
    '    open(os.path.join(hs, "steam-launched.tmp"), "w").write(target + "\\n")\n' +
    '    os.rename(os.path.join(hs, "steam-launched.tmp"), os.path.join(hs, "steam-launched"))\n' +
    '    answer = None\n' +
    '    for _ in range(600):\n' +
    '        if os.path.exists(os.path.join(hs, "steam-prompt")):\n' +
    '            answer = open(os.path.join(hs, "steam-prompt")).read().strip()\n' +
    '            break\n' +
    '        time.sleep(0.05)\n' +
    '    seen["prompt"] = answer\n' +
    '    seen["started"] = os.path.exists(os.path.join(hs, "target-started"))\n' +
    '    for _ in range(400):\n' +
    '        if os.path.exists(os.path.join(hs, "target-ended")): break\n' +
    '        time.sleep(0.05)\n' +
    '    seen["ended"] = os.path.exists(os.path.join(hs, "target-ended"))\n' +
    'json.dump(seen, open(sys.argv[1], "w"))\n' +
    'if sys.argv[2]: open(os.path.join(request["resultsDir"], "summary.json"), "w").write(sys.argv[2])' +
    `' '${seen}' '${reason === undefined ? '' : summary}'\n`
  )
}

/**
 * run.sh's half of steam.launch: the target shortcut, the prompt watch, a
 * Galleon Steam closed, and a prompt left up. Each waits out target.sh's
 * hold, so this file is apart from device-bundle.test.ts and runs beside it.
 */
describe('device-bundle: steam.launch', () => {
  test('run.sh asks for steam.launch with the target shortcut and answers that no prompt showed', () => {
    const session = fakeSession()
    const seen = join(mkdtempSync(join(tmpdir(), 'bundle-seen-')), 'seen.json')
    const { run, results, testRoot } = runHarness(
      unpackLikeTheBridge(built()),
      SHA,
      steamLaunchingApp(seen, null),
      {},
      session
    )
    assert.equal(run.status, 0, run.stderr)
    const got = JSON.parse(readFileSync(seen, 'utf8'))
    assert.ok(got.checks.includes('steam.launch'), got.checks.join(' '))
    assert.equal(got.steamTarget, TARGET_GAMEID)
    // run.sh answered only once the target had started.
    assert.deepEqual([got.prompt, got.started, got.ended], ['none', true, true])
    assert.equal(
      readFileSync(join(testRoot, 'target.sh'), 'utf8'),
      readFileSync(join(ROOT, 'test/device/target.sh'), 'utf8')
    )
    assert.equal(
      JSON.parse(readFileSync(join(testRoot, 'target.json'), 'utf8')).name,
      'Galleon Device Test Target'
    )
    assert.match(readFileSync(join(session, 'steam.log'), 'utf8'), new RegExp(TARGET_GAMEID))
    const summary = JSON.parse(readFileSync(join(results, 'summary.json'), 'utf8'))
    const check = summary.checks.find((c: { id: string }) => c.id === 'steam.launch')
    assert.equal(check.result, 'pass', JSON.stringify(summary))
    assert.equal(summary.checks[1].result, 'pass', 'the target left the owner state as it was')
    assert.ok(!existsSync(join(testRoot, 'steam-attended.json')))
  })

  test('a Galleon that asked Steam and never reported fails steam.launch as closed', () => {
    const seen = join(mkdtempSync(join(tmpdir(), 'bundle-seen-')), 'seen.json')
    const { run, results } = runHarness(unpackLikeTheBridge(built()), SHA, steamLaunchingApp(seen))
    assert.equal(run.status, 0, run.stderr)
    const summary = JSON.parse(readFileSync(join(results, 'summary.json'), 'utf8'))
    assert.equal(summary.status, 'partial')
    const check = summary.checks.find((c: { id: string }) => c.id === 'steam.launch')
    assert.equal(check?.reason, 'galleon-closed', JSON.stringify(summary))
    assert.equal(check.result, 'fail')
    assert.deepEqual(check.metrics, {
      started: 1,
      prompt: 'none',
      targetEnded: 1,
      galleonSurvived: 0
    })
  })

  test('a prompt left up keeps steam.launch from every later unattended run', () => {
    const testRoot = mkdtempSync(join(tmpdir(), 'bundle-testroot-'))
    const first = join(mkdtempSync(join(tmpdir(), 'bundle-seen-')), 'seen.json')
    const once = runHarness(
      unpackLikeTheBridge(built()),
      SHA,
      steamLaunchingApp(first, 'needs-attended'),
      { GALLEON_TEST_ROOT: testRoot }
    )
    assert.equal(once.run.status, 0, once.run.stderr)
    const record = JSON.parse(readFileSync(join(testRoot, 'steam-attended.json'), 'utf8'))
    assert.deepEqual([record.check, record.sha], ['steam.launch', SHA])

    const session = fakeSession()
    const second = join(mkdtempSync(join(tmpdir(), 'bundle-seen-')), 'seen.json')
    const again = runHarness(
      unpackLikeTheBridge(built()),
      SHA,
      steamLaunchingApp(second, 'needs-attended'),
      { GALLEON_TEST_ROOT: testRoot },
      session
    )
    assert.equal(again.run.status, 0, again.run.stderr)
    const got = JSON.parse(readFileSync(second, 'utf8'))
    assert.ok(!got.checks.includes('steam.launch'), got.checks.join(' '))
    assert.equal(got.steamTarget, null)
    assert.doesNotMatch(readFileSync(join(session, 'steam.log'), 'utf8'), new RegExp(TARGET_GAMEID))
    assert.match(
      readFileSync(join(again.results, 'logs/harness.log'), 'utf8'),
      /waits for an attended run/
    )
  })
})
