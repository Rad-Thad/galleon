import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, test } from 'node:test'
import { BUILD_INFO_NAME, BUNDLE_NAME, buildInfo, writeBundle } from './device-bundle.mjs'

/**
 * The bundle is the one thing the bridge on the Nova runs, and it cannot be
 * looked at there: a bundle the bridge refuses to unpack, or a run.sh that
 * writes no summary, means no device result for any feature at all.
 */

const ROOT = resolve(import.meta.dirname, '..')
const SHA = 'a'.repeat(40)
const BUILT_AT = '2026-10-09T12:00:00Z'
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version

function built(sha = SHA) {
  const out = mkdtempSync(join(tmpdir(), 'bundle-out-'))
  writeBundle({ root: ROOT, out, sha, builtAt: BUILT_AT })
  return out
}

/** Unpacked with the bridge's own `safe_extract`, the way the Nova does it. */
function unpackLikeTheBridge(out: string) {
  const target = join(out, 'bundle')
  execFileSync('python3', [
    '-I',
    '-c',
    'import sys; sys.path.insert(0, sys.argv[1]); import galleon_device_bridge as b; ' +
      'from pathlib import Path; b.safe_extract(Path(sys.argv[2]), Path(sys.argv[3]))',
    join(ROOT, 'tools/device-bridge'),
    join(out, BUNDLE_NAME),
    target
  ])
  return target
}

/**
 * A stand-in for the Nova's user manager: Game Mode is up unless `inactive`,
 * and the desktop session's variables are the ones it reports.
 */
function fakeSession(inactive = false) {
  const bin = mkdtempSync(join(tmpdir(), 'bundle-session-'))
  const state = inactive ? 'inactive' : 'active'
  writeFileSync(
    join(bin, 'systemctl'),
    '#!/bin/sh\n' +
      `[ "$2" = is-active ] && { echo ${state}; exit 0; }\n` +
      '[ "$2" = show-environment ] && { echo DISPLAY=:7; exit 0; }\n' +
      'exit 1\n'
  )
  chmodSync(join(bin, 'systemctl'), 0o755)
  return bin
}

function runHarness(
  bundle: string,
  sha: string,
  appimage: boolean,
  env: Record<string, string> = {},
  session = fakeSession()
) {
  const results = mkdtempSync(join(tmpdir(), 'bundle-results-'))
  mkdirSync(join(results, 'logs'))
  const image = join(results, 'Galleon-arm64.AppImage')
  if (appimage) {
    writeFileSync(image, '')
    chmodSync(image, 0o755)
  }
  const path = env.PATH ?? process.env.PATH
  const run = spawnSync('/bin/sh', [join(bundle, 'run.sh')], {
    env: {
      RESULTS_DIR: results,
      GALLEON_SHA: sha,
      GALLEON_APPIMAGE: image,
      GALLEON_TEST_ROOT: results,
      // The bridge's settings are read from the home; this one has none.
      HOME: mkdtempSync(join(tmpdir(), 'bundle-home-')),
      ...env,
      PATH: `${session}:${path}`
    },
    encoding: 'utf8'
  })
  return { run, results }
}

describe('device-bundle', () => {
  test('build-info refuses anything but a full commit and an integer contract', () => {
    const fields = { sha: SHA, version: '1.0.0', builtAt: BUILT_AT, bundleContract: 1 }
    assert.deepEqual(buildInfo(fields), fields)
    assert.throws(() => buildInfo({ ...fields, sha: 'abc123' }), /40-character/)
    assert.throws(() => buildInfo({ ...fields, sha: 'A'.repeat(40) }), /40-character/)
    assert.throws(() => buildInfo({ ...fields, bundleContract: Number.NaN }), /contract/)
  })

  test('build-info names the commit, the version and the bundle contract', () => {
    const info = JSON.parse(readFileSync(join(built(), BUILD_INFO_NAME), 'utf8'))
    const contract = JSON.parse(readFileSync(join(ROOT, 'test/device/bundle.json'), 'utf8'))
    assert.deepEqual(info, {
      sha: SHA,
      version: VERSION,
      builtAt: BUILT_AT,
      bundleContract: contract.contract
    })
  })

  test('the same commit packs to the same bytes', () => {
    const one = readFileSync(join(built(), BUNDLE_NAME))
    const two = readFileSync(join(built(), BUNDLE_NAME))
    assert.ok(one.equals(two))
  })

  test('the bridge unpacks it and finds run.sh, the manifest and its own next copy', () => {
    const bundle = unpackLikeTheBridge(built())
    const listing = execFileSync('find', ['.', '-type', 'f'], { cwd: bundle, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .sort()
    for (const file of [
      './run.sh',
      './bundle.json',
      './build-info.json',
      './ownerstate.py',
      './owner-state.json',
      './signin.py',
      './shortcuts.py',
      './steamcef.py',
      './launch.sh',
      './current.py',
      './session.py',
      './bridge/galleon_device_bridge.py',
      './bridge/install.sh',
      './bridge/VERSION.json',
      './bridge/systemd/galleon-device-bridge.timer'
    ]) {
      assert.ok(listing.includes(file), `${file} is in the bundle`)
    }
    assert.ok(!listing.some((file) => file.includes('test_')), 'no bridge or helper tests')
    assert.equal(JSON.parse(readFileSync(join(bundle, 'bundle.json'), 'utf8')).minBridge, 1)
  })

  test('run.sh writes a summary with harness.run passing for its own commit', () => {
    const { run, results } = runHarness(unpackLikeTheBridge(built()), SHA, true)
    assert.equal(run.status, 0, run.stderr)
    const summary = JSON.parse(readFileSync(join(results, 'summary.json'), 'utf8'))
    assert.equal(summary.schema, 1)
    assert.equal(summary.sha, SHA)
    assert.equal(summary.version, VERSION)
    assert.equal(summary.status, 'complete')
    assert.deepEqual(
      summary.checks.map((check: { id: string; result: string }) => [check.id, check.result]),
      [['harness.run', 'pass']]
    )
    assert.ok(readFileSync(join(results, 'logs/harness.log'), 'utf8').includes('pass'))
  })

  test('run.sh fails harness.run for another commit or a missing AppImage', () => {
    const bundle = unpackLikeTheBridge(built())
    for (const [sha, appimage, why] of [
      ['b'.repeat(40), true, /another commit/],
      [SHA, false, /AppImage/]
    ] as const) {
      const { run, results } = runHarness(bundle, sha, appimage)
      assert.equal(run.status, 0, run.stderr)
      const [check] = JSON.parse(readFileSync(join(results, 'summary.json'), 'utf8')).checks
      assert.equal(check.result, 'fail')
      assert.match(check.reason, why)
    }
  })

  test('run.sh copies the power state the device shows, and only reads it', () => {
    const root = mkdtempSync(join(tmpdir(), 'bundle-root-'))
    const put = (path: string, text: string) => {
      mkdirSync(join(root, path, '..'), { recursive: true })
      writeFileSync(join(root, path), text)
    }
    put('run/armada/perf-state.json', '{"global": {"cores": 8}}')
    put('usr/share/armada/power-profiles.conf', 'default_profile=balanced\n')
    put('sys/devices/system/cpu/cpufreq/policy7/scaling_governor', 'conservative\n')
    put('sys/class/devfreq/3d00000.gpu/governor', 'simple_ondemand\n')
    const bin = mkdtempSync(join(tmpdir(), 'bundle-bin-'))
    const calls = join(bin, 'calls')
    writeFileSync(
      join(bin, 'armada-power'),
      `#!/bin/sh\necho "$*" >>'${calls}'\necho "profile: balanced"\n`
    )
    chmodSync(join(bin, 'armada-power'), 0o755)

    const { run, results } = runHarness(unpackLikeTheBridge(built()), SHA, true, {
      GALLEON_FACTS_ROOT: root,
      PATH: `${bin}:${process.env.PATH}`
    })
    assert.equal(run.status, 0, run.stderr)
    const facts = readFileSync(join(results, 'logs/power-facts.txt'), 'utf8')
    for (const line of [
      '== /run/armada/perf-state.json\n{"global": {"cores": 8}}',
      '== /etc/armada/power-profiles.conf\n(unreadable)',
      '== /usr/share/armada/power-profiles.conf\ndefault_profile=balanced',
      '== /sys/devices/system/cpu/cpufreq/policy7/scaling_governor\nconservative',
      '== /sys/class/devfreq/3d00000.gpu/governor\nsimple_ondemand',
      '== armada-power status\nprofile: balanced\n(exit 0)'
    ]) {
      assert.ok(facts.includes(line), `power-facts.txt has ${JSON.stringify(line)}`)
    }
    // `profile` with an argument would switch it; the harness only asks.
    assert.equal(readFileSync(calls, 'utf8'), 'profile\nstatus\n')
    const [check] = JSON.parse(readFileSync(join(results, 'summary.json'), 'utf8')).checks
    assert.deepEqual(check.evidence, ['logs/harness.log', 'logs/power-facts.txt'])
  })

  test('run.sh still passes where none of the power files or armada-power exist', () => {
    const root = mkdtempSync(join(tmpdir(), 'bundle-empty-'))
    const { run, results } = runHarness(unpackLikeTheBridge(built()), SHA, true, {
      GALLEON_FACTS_ROOT: root,
      PATH: '/usr/bin:/bin'
    })
    assert.equal(run.status, 0, run.stderr)
    const facts = readFileSync(join(results, 'logs/power-facts.txt'), 'utf8')
    assert.match(facts, /== \/run\/armada\/perf-state.json\n\(unreadable\)/)
    assert.match(facts, /== armada-power status\n\(not installed\)/)
    const [check] = JSON.parse(readFileSync(join(results, 'summary.json'), 'utf8')).checks
    assert.equal(check.result, 'pass')
  })

  test('run.sh skips, with the reason, when Game Mode is not running', () => {
    const bundle = unpackLikeTheBridge(built())
    const { run, results } = runHarness(bundle, SHA, true, {}, fakeSession(true))
    assert.equal(run.status, 10, run.stderr)
    const summary = JSON.parse(readFileSync(join(results, 'summary.json'), 'utf8'))
    assert.equal(summary.status, 'skipped')
    assert.equal(summary.sha, SHA)
    assert.match(summary.reason, /Game Mode is not running/)
    assert.deepEqual(summary.checks, [])
  })

  test('run.sh --cleanup is safe to run at any time', () => {
    const bundle = unpackLikeTheBridge(built())
    const run = spawnSync('/bin/sh', [join(bundle, 'run.sh'), '--cleanup'], {
      env: { PATH: process.env.PATH }
    })
    assert.equal(run.status, 0)
  })

  test('the command line writes both files, and refuses a short sha', () => {
    const out = mkdtempSync(join(tmpdir(), 'bundle-cli-'))
    const script = join(ROOT, 'scripts/device-bundle.mjs')
    const ok = spawnSync(process.execPath, [script, '--sha', SHA, '--out', out], {
      encoding: 'utf8'
    })
    assert.equal(ok.status, 0, ok.stderr)
    assert.equal(JSON.parse(readFileSync(join(out, BUILD_INFO_NAME), 'utf8')).sha, SHA)
    const bad = spawnSync(process.execPath, [script, '--sha', 'abc', '--out', out], {
      encoding: 'utf8'
    })
    assert.equal(bad.status, 1)
    assert.match(bad.stderr, /40-character/)
  })
})
