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

function runHarness(bundle: string, sha: string, appimage: boolean) {
  const results = mkdtempSync(join(tmpdir(), 'bundle-results-'))
  mkdirSync(join(results, 'logs'))
  const image = join(results, 'Galleon-arm64.AppImage')
  if (appimage) {
    writeFileSync(image, '')
    chmodSync(image, 0o755)
  }
  const run = spawnSync('/bin/sh', [join(bundle, 'run.sh')], {
    env: {
      PATH: process.env.PATH,
      RESULTS_DIR: results,
      GALLEON_SHA: sha,
      GALLEON_APPIMAGE: image
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
      './bridge/galleon_device_bridge.py',
      './bridge/install.sh',
      './bridge/VERSION.json',
      './bridge/systemd/galleon-device-bridge.timer'
    ]) {
      assert.ok(listing.includes(file), `${file} is in the bundle`)
    }
    assert.ok(!listing.some((file) => file.includes('test_')), 'no bridge tests')
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
