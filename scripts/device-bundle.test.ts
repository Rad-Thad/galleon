import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, test } from 'node:test'
import { BUILD_INFO_NAME, BUNDLE_NAME, buildInfo, writeBundle } from './device-bundle.mjs'
import { REQUEST_FILE, parseRequest } from '../src/main/selftest.ts'

/**
 * The bundle is the one thing the bridge on the Nova runs, and it cannot be
 * looked at there: a bundle the bridge refuses to unpack, or a run.sh that
 * writes no summary, means no device result for any feature at all.
 */

const ROOT = resolve(import.meta.dirname, '..')
const SHA = 'a'.repeat(40)
const BUILT_AT = '2026-10-09T12:00:00Z'
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
/** An emulator config the owner-state spec backs up, relative to the home. */
const CONFIG: string = JSON.parse(readFileSync(join(ROOT, 'test/device/owner-state.json'), 'utf8'))
  .configs[0]
const CONFIG_PATTERN = CONFIG.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

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
  // WirePlumber with one sink, 52, whose volume and mute live beside it; a
  // `wpctl.broken` file makes every call fail.
  writeFileSync(
    join(bin, 'wpctl'),
    '#!/bin/sh\n' +
      'd=$(dirname "$0")\n' +
      'echo "$*" >>"$d/wpctl.log"\n' +
      '[ -e "$d/wpctl.broken" ] && exit 1\n' +
      'case $1 in\n' +
      '  inspect) echo "id 52, type PipeWire:Interface:Node" ;;\n' +
      '  get-volume) [ "$2" = 52 ] || exit 1\n' +
      '    m=; [ -e "$d/muted" ] && m=" [MUTED]"\n' +
      '    echo "Volume: $(cat "$d/volume" 2>/dev/null || echo 0.40)$m" ;;\n' +
      '  set-mute) if [ "$3" = 1 ]; then : >"$d/muted"; else rm -f "$d/muted"; fi ;;\n' +
      '  set-volume) echo "$3" >"$d/volume" ;;\n' +
      'esac\n'
  )
  chmodSync(join(bin, 'wpctl'), 0o755)
  // Steam's client, which starts a shortcut's executable on its own, so the
  // run waits on launch.sh's mark; a `steam.broken` file makes it start
  // nothing.
  writeFileSync(
    join(bin, 'steam'),
    '#!/bin/sh\n' +
      'd=$(dirname "$0")\n' +
      'echo "$*" >>"$d/steam.log"\n' +
      '[ -e "$d/steam.broken" ] && exit 0\n' +
      // `steam.late` holds a delay before the start, which run.sh may have
      // stopped waiting for.
      'late=$(cat "$d/steam.late" 2>/dev/null || echo 0)\n' +
      'case $1 in steam://rungameid/*)\n' +
      '  (sleep "$late"; "$GALLEON_TEST_ROOT/launch.sh") </dev/null >/dev/null 2>&1 &\n' +
      'esac\n'
  )
  chmodSync(join(bin, 'steam'), 0o755)
  return bin
}

/**
 * Steam's shortcut list (binary VDF) holding the test shortcut, so a run finds
 * it there rather than asking a debugger the test machine does not have.
 */
function shortcutsVdf(appid: number, name = 'Galleon Device Test') {
  const id = Buffer.alloc(4)
  id.writeInt32LE(appid | 0)
  return Buffer.concat([
    Buffer.from('\x00shortcuts\x00\x000\x00\x02appid\x00', 'latin1'),
    id,
    Buffer.from(`\x01AppName\x00${name}\x00\x08\x08\x08`, 'utf8')
  ])
}

const APPID = 3060399406

function withShortcut(home: string) {
  const config = join(home, '.local/share/Steam/userdata/1001/config')
  mkdirSync(config, { recursive: true })
  writeFileSync(join(config, 'shortcuts.vdf'), shortcutsVdf(APPID))
  return home
}

function runHarness(
  bundle: string,
  sha: string,
  appimage: boolean | string,
  env: Record<string, string> = {},
  session = fakeSession()
) {
  const results = mkdtempSync(join(tmpdir(), 'bundle-results-'))
  mkdirSync(join(results, 'logs'))
  const image = join(results, 'Galleon-arm64.AppImage')
  if (appimage !== false) {
    // An empty file runs as an empty script: the app starts and quits.
    writeFileSync(image, appimage === true ? '' : appimage)
    chmodSync(image, 0o755)
  }
  const path = env.PATH ?? process.env.PATH
  const testRoot = env.GALLEON_TEST_ROOT ?? mkdtempSync(join(tmpdir(), 'bundle-testroot-'))
  const testDir = join(testRoot, sha)
  mkdirSync(testDir, { recursive: true })
  const home = env.HOME ?? mkdtempSync(join(tmpdir(), 'bundle-home-'))
  // Steam already lists the test shortcut unless the test says otherwise.
  if (!env.GALLEON_STEAM_CEF) withShortcut(home)
  const run = spawnSync('/bin/sh', [join(bundle, 'run.sh')], {
    env: {
      RESULTS_DIR: results,
      GALLEON_SHA: sha,
      GALLEON_APPIMAGE: image,
      GALLEON_TEST_ROOT: testRoot,
      GALLEON_TEST_DIR: testDir,
      // An empty root: no power files, and no process that would read as
      // someone playing, whatever else runs on this machine.
      GALLEON_FACTS_ROOT: mkdtempSync(join(tmpdir(), 'bundle-facts-')),
      GALLEON_START_WAIT_SECONDS: '5',
      GALLEON_STOP_WAIT_SECONDS: '3',
      // The owner's home: the bridge's settings, the owner state and Steam's
      // shortcuts are read from it.
      ...env,
      HOME: home,
      PATH: `${session}:${path}`
    },
    encoding: 'utf8'
  })
  return { run, results, testDir, testRoot, home }
}

/**
 * A loopback server that takes connections and answers none of them for a
 * while, in a process of its own since the run blocks this one.
 */
function silentServer() {
  const portFile = join(mkdtempSync(join(tmpdir(), 'bundle-cef-')), 'port')
  const server = spawn(
    'python3',
    [
      '-I',
      '-c',
      'import os, socket, sys, time\n' +
        's = socket.socket(); s.bind(("127.0.0.1", 0)); s.listen(4)\n' +
        'open(sys.argv[1] + ".tmp", "w").write(str(s.getsockname()[1]))\n' +
        'os.rename(sys.argv[1] + ".tmp", sys.argv[1])\n' +
        'while True:\n' +
        '    c, _ = s.accept(); time.sleep(2); c.close()\n',
      portFile
    ],
    { stdio: 'ignore' }
  )
  while (!existsSync(portFile)) execFileSync('sleep', ['0.05'])
  return { server, port: Number(readFileSync(portFile, 'utf8')) }
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
      './audio.py',
      './selftestrequest.py',
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
      [
        ['harness.run', 'pass'],
        ['safety.owner-state', 'pass']
      ]
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

  test('run.sh puts the shortcut executable in the test root and finds the shortcut Steam lists', () => {
    const testRoot = mkdtempSync(join(tmpdir(), 'bundle-testroot-'))
    // A link left where launch.sh goes is replaced, never written through.
    const elsewhere = join(mkdtempSync(join(tmpdir(), 'bundle-elsewhere-')), 'file')
    writeFileSync(elsewhere, 'untouched\n')
    symlinkSync(elsewhere, join(testRoot, 'launch.sh'))
    const { run, results } = runHarness(unpackLikeTheBridge(built()), SHA, true, {
      GALLEON_TEST_ROOT: testRoot
    })
    assert.equal(run.status, 0, run.stderr)
    assert.equal(readFileSync(elsewhere, 'utf8'), 'untouched\n')
    for (const name of ['launch.sh', 'current.py']) {
      const copied = lstatSync(join(testRoot, name))
      assert.ok(copied.isFile() && (copied.mode & 0o111) !== 0, name)
      assert.equal(
        readFileSync(join(testRoot, name), 'utf8'),
        readFileSync(join(ROOT, 'test/device', name), 'utf8')
      )
    }
    const record = JSON.parse(readFileSync(join(testRoot, 'shortcut.json'), 'utf8'))
    assert.deepEqual(record, {
      name: 'Galleon Device Test',
      exe: join(testRoot, 'launch.sh'),
      appid: APPID
    })
    const summary = JSON.parse(readFileSync(join(results, 'summary.json'), 'utf8'))
    assert.equal(summary.status, 'complete')
    assert.equal(summary.checks[0].result, 'pass')
    assert.match(
      readFileSync(join(results, 'logs/harness.log'), 'utf8'),
      /"source": "shortcuts.vdf"/
    )
  })

  test('run.sh skips before the owner-state manifest when Steam cannot be asked for the shortcut', () => {
    const { run, results, testDir } = runHarness(unpackLikeTheBridge(built()), SHA, true, {
      GALLEON_STEAM_CEF: 'http://127.0.0.1:1'
    })
    assert.equal(run.status, 10, run.stderr)
    const summary = JSON.parse(readFileSync(join(results, 'summary.json'), 'utf8'))
    assert.deepEqual([summary.status, summary.reason], ['skipped', 'steam-cef-unavailable'])
    assert.ok(!existsSync(join(testDir, 'owner-state')))
    assert.ok(!existsSync(join(testDir, 'home')))
  })

  test('run.sh gives the app a test home without sync, and with no sign-in says so', () => {
    const { run, results, testDir } = runHarness(unpackLikeTheBridge(built()), SHA, true)
    assert.equal(run.status, 0, run.stderr)
    const settings = JSON.parse(readFileSync(join(testDir, 'home/config/settings.json'), 'utf8'))
    assert.deepEqual(settings.settings, {
      syncSavesDown: false,
      syncSavesUp: false,
      deviceId: '',
      setupComplete: true
    })
    assert.ok(!existsSync(join(testDir, 'home/config/credentials.bin')))
    const summary = JSON.parse(readFileSync(join(results, 'summary.json'), 'utf8'))
    assert.ok(summary.notes.includes('sign-in: no-importable-credentials'), summary.notes)
    assert.equal(summary.checks[0].result, 'pass')
  })

  test("run.sh copies stock RomMix's sign-in into the test home and leaves the owner's alone", () => {
    const home = mkdtempSync(join(tmpdir(), 'bundle-owner-'))
    const config = join(home, 'rommix/config')
    mkdirSync(config, { recursive: true })
    writeFileSync(
      join(config, 'settings.json'),
      JSON.stringify({ server: { baseUrl: 'http://romm.test', authMode: 'token' } })
    )
    const stored = Buffer.concat([
      Buffer.from('RAW1'),
      Buffer.from(JSON.stringify({ accessToken: 'a', refreshToken: 'r', deviceId: 'd' }))
    ])
    writeFileSync(join(config, 'credentials.bin'), stored)
    const { run, results, testDir } = runHarness(unpackLikeTheBridge(built()), SHA, true, {
      HOME: home
    })
    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(readFileSync(join(config, 'credentials.bin')), stored)
    const copied = readFileSync(join(testDir, 'home/config/credentials.bin'), 'utf8')
    assert.ok(copied.startsWith('RAW1'))
    assert.doesNotMatch(copied, /"r"|"d"/)
    const summary = JSON.parse(readFileSync(join(results, 'summary.json'), 'utf8'))
    assert.ok(summary.notes.includes('sign-in: rommix'), summary.notes)
    const owner = summary.checks.find((check: { id: string }) => check.id === 'safety.owner-state')
    assert.equal(owner.result, 'pass')
    assert.doesNotMatch(readFileSync(join(results, 'logs/harness.log'), 'utf8'), /romm\.test/)
  })

  test('run.sh holds the owner state, and keeps the manifest off the results', () => {
    const home = mkdtempSync(join(tmpdir(), 'bundle-owner-'))
    mkdirSync(join(home, CONFIG, '..'), { recursive: true })
    writeFileSync(join(home, CONFIG), 'Volume=100\n')
    const { run, results, testDir } = runHarness(unpackLikeTheBridge(built()), SHA, true, {
      HOME: home
    })
    assert.equal(run.status, 0, run.stderr)
    const checks = JSON.parse(readFileSync(join(results, 'summary.json'), 'utf8')).checks
    const owner = checks.find((check: { id: string }) => check.id === 'safety.owner-state')
    assert.deepEqual(
      [owner.result, owner.reason, owner.evidence],
      ['pass', null, ['logs/owner-state.txt']]
    )
    assert.equal(readFileSync(join(results, 'logs/owner-state.txt'), 'utf8'), '')
    const manifest = JSON.parse(readFileSync(join(testDir, 'owner-state/before.json'), 'utf8'))
    assert.ok(CONFIG in manifest.files)
    // Its work done, the backup goes, so a later --cleanup restores nothing stale.
    assert.ok(!existsSync(join(testDir, 'owner-state/backup')))
    const published = execFileSync('find', ['.'], { cwd: results, encoding: 'utf8' })
    assert.ok(!/before|after|backup/.test(published), published)
  })

  test('run.sh fails safety.owner-state when an emulator rewrites its config, and puts it back', () => {
    const home = mkdtempSync(join(tmpdir(), 'bundle-owner-'))
    const config = join(home, CONFIG)
    mkdirSync(join(config, '..'), { recursive: true })
    writeFileSync(config, 'Volume=100\n')
    // Something the run starts rewrites the owner's config; armada-power is
    // the one program the minimal harness runs.
    const bin = mkdtempSync(join(tmpdir(), 'bundle-bin-'))
    writeFileSync(join(bin, 'armada-power'), `#!/bin/sh\necho Volume=0 >'${config}'\n`)
    chmodSync(join(bin, 'armada-power'), 0o755)
    const { run, results } = runHarness(unpackLikeTheBridge(built()), SHA, true, {
      HOME: home,
      PATH: `${bin}:${process.env.PATH}`
    })
    assert.equal(run.status, 0, run.stderr)
    const checks = JSON.parse(readFileSync(join(results, 'summary.json'), 'utf8')).checks
    const owner = checks.find((check: { id: string }) => check.id === 'safety.owner-state')
    assert.equal(owner.result, 'fail')
    assert.match(owner.reason, /changed/)
    assert.equal(readFileSync(config, 'utf8'), 'Volume=100\n')
    const log = readFileSync(join(results, 'logs/owner-state.txt'), 'utf8')
    assert.match(log, new RegExp(`^changed: ${CONFIG_PATTERN}$`, 'm'))
    assert.match(log, new RegExp(`^restored: ${CONFIG_PATTERN}$`, 'm'))
  })

  test('run.sh fails safety.owner-state when the run changed a config it then cannot restore', () => {
    const home = mkdtempSync(join(tmpdir(), 'bundle-owner-'))
    const config = join(home, CONFIG)
    mkdirSync(join(config, '..'), { recursive: true })
    writeFileSync(config, 'Volume=100\n')
    // The rewrite also takes the backed-up copy away, keeping only the index.
    const bin = mkdtempSync(join(tmpdir(), 'bundle-bin-'))
    writeFileSync(
      join(bin, 'armada-power'),
      `#!/bin/sh\necho Volume=0 >'${config}'\n` +
        'find "$GALLEON_TEST_DIR/owner-state/backup" -type f ! -name index.json -delete\n'
    )
    chmodSync(join(bin, 'armada-power'), 0o755)
    const { run, results, testDir } = runHarness(unpackLikeTheBridge(built()), SHA, true, {
      HOME: home,
      PATH: `${bin}:${process.env.PATH}`
    })
    assert.equal(run.status, 0, run.stderr)
    const checks = JSON.parse(readFileSync(join(results, 'summary.json'), 'utf8')).checks
    const owner = checks.find((check: { id: string }) => check.id === 'safety.owner-state')
    assert.equal(owner.result, 'fail')
    assert.match(owner.reason, /changed/)
    // Left for --cleanup to try again.
    assert.ok(existsSync(join(testDir, 'owner-state/backup/index.json')))
  })

  test('run.sh fails safety.owner-state when a config was put back though the second manifest failed', () => {
    const home = mkdtempSync(join(tmpdir(), 'bundle-owner-'))
    const config = join(home, CONFIG)
    mkdirSync(join(config, '..'), { recursive: true })
    writeFileSync(config, 'Volume=100\n')
    // A folder where the second manifest's temporary file goes makes it fail.
    const bin = mkdtempSync(join(tmpdir(), 'bundle-bin-'))
    writeFileSync(
      join(bin, 'armada-power'),
      `#!/bin/sh\necho Volume=0 >'${config}'\n` +
        'mkdir -p "$GALLEON_TEST_DIR/owner-state/after.json.tmp"\n'
    )
    chmodSync(join(bin, 'armada-power'), 0o755)
    const { run, results } = runHarness(unpackLikeTheBridge(built()), SHA, true, {
      HOME: home,
      PATH: `${bin}:${process.env.PATH}`
    })
    assert.equal(run.status, 0, run.stderr)
    const checks = JSON.parse(readFileSync(join(results, 'summary.json'), 'utf8')).checks
    const owner = checks.find((check: { id: string }) => check.id === 'safety.owner-state')
    assert.equal(owner.result, 'fail')
    assert.match(owner.reason, /restored/)
    assert.equal(readFileSync(config, 'utf8'), 'Volume=100\n')
  })

  test('run.sh skips safety.owner-state and fails harness.run when no manifest can be taken', () => {
    const testDir = join(mkdtempSync(join(tmpdir(), 'bundle-testdir-')), 'not-a-folder')
    writeFileSync(testDir, '')
    const { run, results } = runHarness(unpackLikeTheBridge(built()), SHA, true, {
      GALLEON_TEST_DIR: testDir
    })
    assert.equal(run.status, 0, run.stderr)
    const checks = JSON.parse(readFileSync(join(results, 'summary.json'), 'utf8')).checks
    assert.deepEqual(
      checks.map((check: { id: string; result: string; reason: string }) => [
        check.id,
        check.result,
        check.reason
      ]),
      [
        ['harness.run', 'fail', 'the owner-state manifest could not be taken'],
        ['safety.owner-state', 'skip', 'the owner-state manifest could not be taken']
      ]
    )
  })

  test('run.sh writes the launch request for this build while it runs, and removes it', () => {
    const testRoot = mkdtempSync(join(tmpdir(), 'bundle-testroot-'))
    const seen = join(mkdtempSync(join(tmpdir(), 'bundle-seen-')), 'current.json')
    // armada-power is called mid-run, after the request is written.
    const bin = mkdtempSync(join(tmpdir(), 'bundle-bin-'))
    writeFileSync(
      join(bin, 'armada-power'),
      `#!/bin/sh\n[ -e '${seen}' ] || cp -p '${join(testRoot, 'current.json')}' '${seen}'\n`
    )
    chmodSync(join(bin, 'armada-power'), 0o755)
    const { run, results, testDir } = runHarness(unpackLikeTheBridge(built()), SHA, true, {
      GALLEON_TEST_ROOT: testRoot,
      DEVICE_TEST_BUDGET_SECONDS: '600',
      PATH: `${bin}:${process.env.PATH}`
    })
    assert.equal(run.status, 0, run.stderr)
    const request = JSON.parse(readFileSync(seen, 'utf8'))
    assert.deepEqual(
      [request.appimage, request.home, request.results, request.sha],
      [join(results, 'Galleon-arm64.AppImage'), join(testDir, 'home'), results, SHA]
    )
    const left = request.expires - Date.now() / 1000
    assert.ok(left > 500 && left <= 600, String(left))
    assert.equal(statSync(seen).mode & 0o077, 0)
    assert.ok(!existsSync(join(testRoot, 'current.json')))
    assert.equal(
      JSON.parse(readFileSync(join(results, 'summary.json'), 'utf8')).checks[0].result,
      'pass'
    )
    // The shortcut started by hand afterwards starts nothing.
    rmSync(join(testDir, 'home/launch'), { recursive: true })
    const byHand = spawnSync('/bin/sh', [join(testRoot, 'launch.sh')], {
      env: { PATH: process.env.PATH },
      encoding: 'utf8'
    })
    assert.equal(byHand.status, 0, byHand.stderr)
    assert.ok(!existsSync(join(testDir, 'home/launch')))
  })

  test('run.sh gives the app a self-test request it takes, and removes it', () => {
    const testRoot = mkdtempSync(join(tmpdir(), 'bundle-testroot-'))
    const testDir = join(testRoot, SHA)
    const seen = join(mkdtempSync(join(tmpdir(), 'bundle-seen-')), 'request.json')
    // armada-power is called mid-run, after the request is written.
    const bin = mkdtempSync(join(tmpdir(), 'bundle-bin-'))
    writeFileSync(
      join(bin, 'armada-power'),
      `#!/bin/sh\n[ -e '${seen}' ] || cp -p '${join(testDir, 'home', REQUEST_FILE)}' '${seen}'\n`
    )
    chmodSync(join(bin, 'armada-power'), 0o755)
    const { run, results } = runHarness(unpackLikeTheBridge(built()), SHA, true, {
      GALLEON_TEST_ROOT: testRoot,
      DEVICE_TEST_BUDGET_SECONDS: '600',
      PATH: `${bin}:${process.env.PATH}`
    })
    assert.equal(run.status, 0, run.stderr)
    assert.equal(statSync(seen).mode & 0o077, 0)
    const taken = parseRequest(JSON.parse(readFileSync(seen, 'utf8')))
    assert.equal(taken.kind, 'request')
    const request = taken.kind === 'request' ? taken.request : undefined
    assert.deepEqual(
      [request?.sha, request?.version, request?.resultsDir, request?.handshakeDir],
      [SHA, VERSION, join(results, 'app'), join(testDir, 'handshake')]
    )
    assert.deepEqual(
      [request?.readOnlyServer, request?.privacy, request?.abortOnInput, request?.fakeRomm],
      [true, true, true, null]
    )
    assert.ok(request?.checks.includes('selftest.complete'))
    assert.deepEqual(request?.profiles, ['performance', 'balanced'])
    // The app's budget ends before the bridge's, leaving time to stop it.
    const budget = request?.budgetSeconds ?? 0
    assert.ok(budget > 400 && budget < 600, String(budget))
    assert.ok(lstatSync(join(results, 'app')).isDirectory())
    assert.ok(lstatSync(join(testDir, 'handshake')).isDirectory())
    assert.ok(!existsSync(join(testDir, 'home', REQUEST_FILE)))
    assert.equal(
      JSON.parse(readFileSync(join(results, 'summary.json'), 'utf8')).checks[0].result,
      'pass'
    )
  })

  test('run.sh writes no launch request and fails harness.run without a self-test request', () => {
    const testRoot = mkdtempSync(join(tmpdir(), 'bundle-testroot-'))
    const seen = join(mkdtempSync(join(tmpdir(), 'bundle-seen-')), 'current.json')
    const bin = mkdtempSync(join(tmpdir(), 'bundle-bin-'))
    writeFileSync(
      join(bin, 'armada-power'),
      `#!/bin/sh\n[ -e '${seen}' ] || cp -p '${join(testRoot, 'current.json')}' '${seen}' 2>/dev/null\nexit 0\n`
    )
    chmodSync(join(bin, 'armada-power'), 0o755)
    // A budget too short to leave the app any time is one the request refuses.
    const { run, results } = runHarness(unpackLikeTheBridge(built()), SHA, true, {
      GALLEON_TEST_ROOT: testRoot,
      DEVICE_TEST_BUDGET_SECONDS: '60',
      PATH: `${bin}:${process.env.PATH}`
    })
    assert.equal(run.status, 0, run.stderr)
    const check = JSON.parse(readFileSync(join(results, 'summary.json'), 'utf8')).checks[0]
    assert.deepEqual(
      [check.result, check.reason],
      ['fail', 'the self-test request could not be written']
    )
    assert.ok(!existsSync(seen))
  })

  test('run.sh --cleanup removes the self-test request a stopped run left', () => {
    const bundle = unpackLikeTheBridge(built())
    const testDir = mkdtempSync(join(tmpdir(), 'bundle-testdir-'))
    mkdirSync(join(testDir, 'home'))
    writeFileSync(join(testDir, 'home', REQUEST_FILE), '{}')
    writeFileSync(join(testDir, 'home', 'self-test-request.taken.json'), '{}')
    const run = spawnSync('/bin/sh', [join(bundle, 'run.sh'), '--cleanup'], {
      env: { PATH: process.env.PATH, GALLEON_TEST_DIR: testDir }
    })
    assert.equal(run.status, 0)
    assert.ok(!existsSync(join(testDir, 'home', REQUEST_FILE)))
    assert.ok(!existsSync(join(testDir, 'home', 'self-test-request.taken.json')))
  })

  test('run.sh mutes the sound while it runs and puts it back', () => {
    const session = fakeSession()
    const seen = join(mkdtempSync(join(tmpdir(), 'bundle-seen-')), 'muted')
    // armada-power is called mid-run, after the mute.
    const bin = mkdtempSync(join(tmpdir(), 'bundle-bin-'))
    writeFileSync(
      join(bin, 'armada-power'),
      `#!/bin/sh\n[ -e '${join(session, 'muted')}' ] && : >'${seen}'\nexit 0\n`
    )
    chmodSync(join(bin, 'armada-power'), 0o755)
    const { run, results, testRoot } = runHarness(
      unpackLikeTheBridge(built()),
      SHA,
      true,
      { PATH: `${bin}:${process.env.PATH}` },
      session
    )
    assert.equal(run.status, 0, run.stderr)
    assert.ok(existsSync(seen), 'the sound was not muted during the run')
    assert.ok(!existsSync(join(session, 'muted')))
    assert.equal(readFileSync(join(session, 'wpctl.log'), 'utf8').match(/^set-volume/m), null)
    assert.ok(!existsSync(join(testRoot, 'audio.json')))
    const summary = JSON.parse(readFileSync(join(results, 'summary.json'), 'utf8'))
    assert.equal(summary.checks[0].result, 'pass')
    assert.ok(summary.notes.includes('audio: muted and put back'), summary.notes.join('; '))
  })

  test('run.sh starts the app through steam://, muted, and waits for it to quit', () => {
    const session = fakeSession()
    const seen = mkdtempSync(join(tmpdir(), 'bundle-seen-'))
    // The app notes whether the sound was off and which home it was given.
    const app =
      '#!/bin/sh\n' +
      `[ -e '${join(session, 'muted')}' ] && echo muted >'${join(seen, 'sound')}'\n` +
      `echo "$GALLEON_HOME" >'${join(seen, 'home')}'\n`
    const { run, results, testDir } = runHarness(
      unpackLikeTheBridge(built()),
      SHA,
      app,
      {},
      session
    )
    assert.equal(run.status, 0, run.stderr)
    const summary = JSON.parse(readFileSync(join(results, 'summary.json'), 'utf8'))
    assert.equal(summary.checks[0].result, 'pass', summary.checks[0].reason)
    assert.ok(summary.notes.includes('app: exited 0'), summary.notes.join('; '))
    const gameid = (BigInt(APPID) << 32n) | 0x02000000n
    assert.equal(readFileSync(join(session, 'steam.log'), 'utf8'), `steam://rungameid/${gameid}\n`)
    assert.equal(readFileSync(join(seen, 'sound'), 'utf8'), 'muted\n')
    assert.equal(readFileSync(join(seen, 'home'), 'utf8'), `${join(testDir, 'home')}\n`)
    assert.match(readFileSync(join(results, 'logs/harness.log'), 'utf8'), /started through steam/)
    assert.ok(!existsSync(join(session, 'muted')))
  })

  test('run.sh fails harness.run when neither route starts the app', () => {
    const session = fakeSession()
    writeFileSync(join(session, 'steam.broken'), '')
    const { run, results } = runHarness(
      unpackLikeTheBridge(built()),
      SHA,
      true,
      // Nothing listens here, so the debugger's RunGame cannot be asked.
      {
        GALLEON_START_WAIT_SECONDS: '1',
        GALLEON_STEAM_CEF: 'http://127.0.0.1:9',
        HOME: withShortcut(mkdtempSync(join(tmpdir(), 'bundle-home-')))
      },
      session
    )
    assert.equal(run.status, 0, run.stderr)
    const summary = JSON.parse(readFileSync(join(results, 'summary.json'), 'utf8'))
    assert.deepEqual(
      [summary.checks[0].result, summary.checks[0].reason],
      ['fail', 'neither route started the app']
    )
    assert.ok(summary.notes.includes('app: not started'), summary.notes.join('; '))
    assert.ok(!existsSync(join(session, 'muted')))
  })

  test('run.sh stops a start it gave up on that happens before the request is withdrawn', () => {
    const session = fakeSession()
    // Steam starts the shortcut only after run.sh stops waiting for it, and
    // the debugger cannot be asked, so the start is given up on.
    writeFileSync(join(session, 'steam.late'), '0.5')
    const seen = mkdtempSync(join(tmpdir(), 'bundle-seen-'))
    const cef = silentServer()
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
        // A debugger that answers nothing for a while, so the late start
        // lands after run.sh gave up and before it withdraws the request.
        GALLEON_STEAM_CEF: `http://127.0.0.1:${cef.port}`,
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
    assert.throws(() => process.kill(pid, 0))
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
      {
        GALLEON_START_WAIT_SECONDS: '1',
        GALLEON_STEAM_CEF: 'http://127.0.0.1:9',
        HOME: withShortcut(mkdtempSync(join(tmpdir(), 'bundle-home-')))
      },
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
    const pid = Number(readFileSync(join(testDir, 'home/launch/app.pid'), 'utf8'))
    assert.throws(() => process.kill(pid, 0))
  })

  test('run.sh fails harness.run and keeps the record when the sound cannot be put back', () => {
    const session = fakeSession()
    // WirePlumber stops answering after the mute.
    const bin = mkdtempSync(join(tmpdir(), 'bundle-bin-'))
    writeFileSync(join(bin, 'armada-power'), `#!/bin/sh\n: >'${join(session, 'wpctl.broken')}'\n`)
    chmodSync(join(bin, 'armada-power'), 0o755)
    const { run, results, testRoot } = runHarness(
      unpackLikeTheBridge(built()),
      SHA,
      true,
      { PATH: `${bin}:${process.env.PATH}` },
      session
    )
    assert.equal(run.status, 0, run.stderr)
    const summary = JSON.parse(readFileSync(join(results, 'summary.json'), 'utf8'))
    assert.deepEqual(
      [summary.checks[0].result, summary.checks[0].reason],
      ['fail', 'the sound could not be put back as it was']
    )
    assert.ok(summary.notes.includes('audio: muted, not put back'), summary.notes.join('; '))
    assert.ok(existsSync(join(testRoot, 'audio.json')))
    assert.match(readFileSync(join(results, 'logs/harness.log'), 'utf8'), /audio\.py: wpctl/)
  })

  test('run.sh fails harness.run and starts nothing when the sound cannot be muted', () => {
    const session = fakeSession()
    writeFileSync(join(session, 'wpctl.broken'), '')
    const { run, results, testRoot } = runHarness(
      unpackLikeTheBridge(built()),
      SHA,
      true,
      {},
      session
    )
    assert.equal(run.status, 0, run.stderr)
    const summary = JSON.parse(readFileSync(join(results, 'summary.json'), 'utf8'))
    assert.deepEqual(
      [summary.checks[0].result, summary.checks[0].reason],
      ['fail', 'the sound could not be muted, so the app was not started']
    )
    assert.ok(summary.notes.includes('audio: not muted'), summary.notes.join('; '))
    assert.ok(summary.notes.includes('app: not started'), summary.notes.join('; '))
    assert.ok(!existsSync(join(session, 'steam.log')))
    assert.ok(!existsSync(join(testRoot, 'audio.json')))
  })

  test('run.sh --cleanup puts back the sound a stopped run left muted', () => {
    const bundle = unpackLikeTheBridge(built())
    const session = fakeSession()
    const testRoot = mkdtempSync(join(tmpdir(), 'bundle-testroot-'))
    const env = { PATH: `${session}:${process.env.PATH}`, GALLEON_TEST_ROOT: testRoot }
    execFileSync(
      'python3',
      [join(bundle, 'audio.py'), 'mute', '--state', join(testRoot, 'audio.json')],
      { env }
    )
    assert.ok(existsSync(join(session, 'muted')))
    const run = spawnSync('/bin/sh', [join(bundle, 'run.sh'), '--cleanup'], { env })
    assert.equal(run.status, 0)
    assert.ok(!existsSync(join(session, 'muted')))
    assert.ok(!existsSync(join(testRoot, 'audio.json')))
  })

  test('run.sh --cleanup fails while the sound cannot be put back, and keeps the record', () => {
    const bundle = unpackLikeTheBridge(built())
    const session = fakeSession()
    const testRoot = mkdtempSync(join(tmpdir(), 'bundle-testroot-'))
    const env = { PATH: `${session}:${process.env.PATH}`, GALLEON_TEST_ROOT: testRoot }
    execFileSync(
      'python3',
      [join(bundle, 'audio.py'), 'mute', '--state', join(testRoot, 'audio.json')],
      { env }
    )
    writeFileSync(join(session, 'wpctl.broken'), '')
    const run = spawnSync('/bin/sh', [join(bundle, 'run.sh'), '--cleanup'], { env })
    assert.equal(run.status, 1)
    assert.ok(existsSync(join(testRoot, 'audio.json')))
  })

  test('run.sh --cleanup removes the launch request a stopped run left', () => {
    const bundle = unpackLikeTheBridge(built())
    const testRoot = mkdtempSync(join(tmpdir(), 'bundle-testroot-'))
    writeFileSync(join(testRoot, 'current.json'), '{}')
    const run = spawnSync('/bin/sh', [join(bundle, 'run.sh'), '--cleanup'], {
      env: { PATH: process.env.PATH, GALLEON_TEST_ROOT: testRoot }
    })
    assert.equal(run.status, 0)
    assert.ok(!existsSync(join(testRoot, 'current.json')))
  })

  test('run.sh --cleanup still puts back a config when the launch request cannot be removed', () => {
    const bundle = unpackLikeTheBridge(built())
    const home = mkdtempSync(join(tmpdir(), 'bundle-owner-'))
    const config = join(home, CONFIG)
    mkdirSync(join(config, '..'), { recursive: true })
    writeFileSync(config, 'Volume=100\n')
    const testDir = mkdtempSync(join(tmpdir(), 'bundle-testdir-'))
    execFileSync('python3', [
      join(bundle, 'ownerstate.py'),
      '--home',
      home,
      'backup',
      join(testDir, 'owner-state/backup')
    ])
    writeFileSync(config, 'Volume=0\n')
    const testRoot = mkdtempSync(join(tmpdir(), 'bundle-testroot-'))
    mkdirSync(join(testRoot, 'current.json'))
    const run = spawnSync('/bin/sh', [join(bundle, 'run.sh'), '--cleanup'], {
      env: {
        PATH: process.env.PATH,
        HOME: home,
        GALLEON_TEST_DIR: testDir,
        GALLEON_TEST_ROOT: testRoot
      }
    })
    assert.equal(run.status, 1)
    assert.equal(readFileSync(config, 'utf8'), 'Volume=100\n')
    assert.ok(!existsSync(join(testDir, 'owner-state/backup')))
  })

  test('run.sh writes no launch request and fails harness.run when it cannot be written', () => {
    const testRoot = mkdtempSync(join(tmpdir(), 'bundle-testroot-'))
    // A folder where the request's temporary file goes makes the write fail.
    mkdirSync(join(testRoot, 'current.json.tmp'))
    const { run, results } = runHarness(unpackLikeTheBridge(built()), SHA, true, {
      GALLEON_TEST_ROOT: testRoot
    })
    assert.equal(run.status, 0, run.stderr)
    const check = JSON.parse(readFileSync(join(results, 'summary.json'), 'utf8')).checks[0]
    assert.deepEqual(
      [check.result, check.reason],
      ['fail', 'the launch request could not be written']
    )
    assert.ok(!existsSync(join(testRoot, 'current.json')))
  })

  test('run.sh --cleanup puts back a config from the backup a stopped run left', () => {
    const bundle = unpackLikeTheBridge(built())
    const home = mkdtempSync(join(tmpdir(), 'bundle-owner-'))
    const config = join(home, CONFIG)
    mkdirSync(join(config, '..'), { recursive: true })
    writeFileSync(config, 'Volume=100\n')
    const testDir = mkdtempSync(join(tmpdir(), 'bundle-testdir-'))
    execFileSync('python3', [
      join(bundle, 'ownerstate.py'),
      '--home',
      home,
      'backup',
      join(testDir, 'owner-state/backup')
    ])
    writeFileSync(config, 'Volume=0\n')
    const run = spawnSync('/bin/sh', [join(bundle, 'run.sh'), '--cleanup'], {
      env: { PATH: process.env.PATH, HOME: home, GALLEON_TEST_DIR: testDir }
    })
    assert.equal(run.status, 0)
    assert.equal(readFileSync(config, 'utf8'), 'Volume=100\n')
  })

  test('run.sh --cleanup is safe to run at any time', () => {
    const bundle = unpackLikeTheBridge(built())
    const run = spawnSync('/bin/sh', [join(bundle, 'run.sh'), '--cleanup'], {
      env: { PATH: process.env.PATH }
    })
    assert.equal(run.status, 0)
  })

  test('the self-test request the bundle writes is one the app takes as written', () => {
    const bundle = unpackLikeTheBridge(built())
    const home = mkdtempSync(join(tmpdir(), 'bundle-testhome-'))
    const results = mkdtempSync(join(tmpdir(), 'bundle-appresults-'))
    execFileSync('python3', [
      join(bundle, 'selftestrequest.py'),
      'write',
      '--home',
      home,
      '--sha',
      SHA,
      '--version',
      VERSION,
      '--budget',
      '600',
      '--results',
      results,
      '--handshake',
      join(home, 'handshake'),
      '--check',
      'selftest.complete',
      '--check',
      'grid.scroll',
      '--profile',
      'performance',
      '--profile',
      'balanced',
      '--payload',
      'retroarch=payloads/snes/hello.sfc',
      '--saving',
      'retroarch',
      '--screenshot',
      'settings'
    ])
    const taken = parseRequest(JSON.parse(readFileSync(join(home, REQUEST_FILE), 'utf8')))
    assert.deepEqual(taken, {
      kind: 'request',
      request: {
        schema: 1,
        sha: SHA,
        version: VERSION,
        budgetSeconds: 600,
        resultsDir: results,
        handshakeDir: join(home, 'handshake'),
        checks: ['selftest.complete', 'grid.scroll'],
        profiles: ['performance', 'balanced'],
        payloads: { retroarch: 'payloads/snes/hello.sfc' },
        savingPayloads: ['retroarch'],
        fakeRomm: null,
        readOnlyServer: true,
        privacy: true,
        abortOnInput: true,
        screenshots: ['settings']
      }
    })
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
