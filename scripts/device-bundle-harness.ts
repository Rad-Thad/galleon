import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { BUNDLE_NAME, writeBundle } from './device-bundle.mjs'
import { sha256 } from './agent/fetch-fixtures.mjs'

/**
 * What the device-bundle tests share: a bundle built and unpacked as the
 * bridge does it, and a run.sh run against a fake Steam session. Its own
 * module so the run.sh tests that wait out run.sh's own timeouts can be a file
 * of their own, which the test runner runs beside the rest.
 */

export const ROOT = resolve(import.meta.dirname, '..')
export const SHA = 'a'.repeat(40)
export const BUILT_AT = '2026-10-09T12:00:00Z'
export const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
/** An emulator config the owner-state spec backs up, relative to the home. */
export const CONFIG: string = JSON.parse(
  readFileSync(join(ROOT, 'test/device/owner-state.json'), 'utf8')
).configs[0]
export const CONFIG_PATTERN = CONFIG.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

/**
 * A payload manifest of two small programs and the folder fetch-fixtures
 * would have put them in, so the bundle is built without the network.
 */
export function fetchedPayloads(paths = ['roms/gba/one test.gba', 'roms/snes/two.sfc']) {
  const dir = mkdtempSync(join(tmpdir(), 'bundle-payloads-'))
  const entries = paths.map((path) => {
    const bytes = Buffer.from(`homebrew ${path}`)
    mkdirSync(join(dir, 'fetched', path, '..'), { recursive: true })
    writeFileSync(join(dir, 'fetched', path), bytes)
    return {
      path,
      url: `https://example.com/${encodeURIComponent(path)}`,
      sha256: sha256(bytes),
      bytes: bytes.length,
      licence: 'MIT',
      attribution: `Test Author, ${path}`
    }
  })
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ files: entries }))
  return { from: join(dir, 'fetched'), manifest: join(dir, 'manifest.json'), entries }
}

export function built(sha = SHA) {
  const out = mkdtempSync(join(tmpdir(), 'bundle-out-'))
  writeBundle({ root: ROOT, out, sha, builtAt: BUILT_AT })
  return out
}

/** Unpacked with the bridge's own `safe_extract`, the way the Nova does it. */
export function unpackLikeTheBridge(out: string) {
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
 * or until an `inactive` file appears beside it, and the desktop session's
 * variables are the ones it reports.
 */
export function fakeSession(inactive = false) {
  const bin = mkdtempSync(join(tmpdir(), 'bundle-session-'))
  if (inactive) writeFileSync(join(bin, 'inactive'), '')
  writeFileSync(
    join(bin, 'systemctl'),
    '#!/bin/sh\n' +
      '[ "$2" = is-active ] && { [ -e "$(dirname "$0")/inactive" ] && echo inactive || echo active; exit 0; }\n' +
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
      // A started game's page is what Steam shows when the game quits;
      // `steam.stuck` keeps it there.
      // The target shortcut steam.launch asks for starts target.sh instead.
      `case $1 in steam://rungameid/${TARGET_GAMEID})\n` +
      '  (sleep "$late"; "$GALLEON_TEST_ROOT/target.sh") </dev/null >/dev/null 2>&1 &\n' +
      ';; steam://rungameid/*)\n' +
      '  echo /library/app/3060399406 >"$d/route"\n' +
      '  (sleep "$late"; "$GALLEON_TEST_ROOT/launch.sh") </dev/null >/dev/null 2>&1 &\n' +
      ';; steam://open/games) [ -e "$d/steam.stuck" ] || echo /library/home >"$d/route" ;;\n' +
      'esac\n'
  )
  chmodSync(join(bin, 'steam'), 0o755)
  writeFileSync(join(bin, 'route'), '/library/home\n')
  return bin
}

/**
 * Steam's shortcut list (binary VDF) holding the test shortcut, and any others
 * given, so a run finds them there rather than asking a debugger the test
 * machine does not have.
 */
export function shortcutsVdf(
  appid: number,
  name = 'Galleon Device Test',
  more: [number, string][] = []
) {
  const entries = [[appid, name] as [number, string], ...more].map(([id, entryName], index) => {
    const bytes = Buffer.alloc(4)
    bytes.writeInt32LE(id | 0)
    return Buffer.concat([
      Buffer.from(`\x00${index}\x00\x02appid\x00`, 'latin1'),
      bytes,
      Buffer.from(`\x01AppName\x00${entryName}\x00\x08`, 'utf8')
    ])
  })
  return Buffer.concat([
    Buffer.from('\x00shortcuts\x00', 'latin1'),
    ...entries,
    Buffer.from('\x08\x08', 'latin1')
  ])
}

export const APPID = 3060399406
// The second shortcut steam.launch starts (target.sh).
export const TARGET_APPID = 3060399407
export const TARGET_GAMEID = ((BigInt(TARGET_APPID) << 32n) | 0x02000000n).toString()

export function withShortcut(home: string) {
  const config = join(home, '.local/share/Steam/userdata/1001/config')
  mkdirSync(config, { recursive: true })
  writeFileSync(
    join(config, 'shortcuts.vdf'),
    shortcutsVdf(APPID, 'Galleon Device Test', [[TARGET_APPID, 'Galleon Device Test Target']])
  )
  return home
}

/**
 * An app that writes its self-test summary where its request says, as the
 * real one does, with one passing check unless `summary` says otherwise.
 */
export function selfTestApp(summary: Record<string, unknown> = {}) {
  const written = JSON.stringify({
    schema: 1,
    sha: SHA,
    version: VERSION,
    status: 'complete',
    reason: null,
    checks: [
      {
        id: 'selftest.complete',
        result: 'pass',
        metrics: {},
        thresholds: {},
        reason: null,
        evidence: ['logs/selftest.log']
      }
    ],
    notes: [],
    ...summary
  })
  return (
    '#!/bin/sh\n' +
    "exec python3 -I -c 'import json, os, sys\n" +
    'home = os.environ["GALLEON_HOME"]\n' +
    'request = json.load(open(os.path.join(home, "self-test-request.json")))\n' +
    'open(os.path.join(request["resultsDir"], "summary.json"), "w").write(sys.argv[1])' +
    `' '${written}'\n`
  )
}

/**
 * An app that keeps its self-test request, and the ROM folder's files with
 * their hashes, in `seen`, then downloads a ROM of its own into that folder.
 */
export function payloadApp(seen: string) {
  return (
    '#!/bin/sh\n' +
    "exec python3 -I -c 'import hashlib, json, os, shutil, sys\n" +
    'home = os.environ["GALLEON_HOME"]\n' +
    'shutil.copy(os.path.join(home, "self-test-request.json"), os.path.join(sys.argv[1], "request.json"))\n' +
    'roms = os.path.join(home, "roms")\n' +
    'held = {}\n' +
    'for folder, _, names in os.walk(roms):\n' +
    '    for name in names:\n' +
    '        path = os.path.join(folder, name)\n' +
    '        held[os.path.relpath(path, home)] = hashlib.sha256(open(path, "rb").read()).hexdigest()\n' +
    'json.dump(held, open(os.path.join(sys.argv[1], "roms.json"), "w"))\n' +
    'os.makedirs(os.path.join(roms, "snes"), exist_ok=True)\n' +
    'open(os.path.join(roms, "snes", "downloaded.sfc"), "wb").write(b"rom")' +
    `' '${seen}'\n`
  )
}

/**
 * armada-power with the profile in force, by name, in a file beside it, and
 * every call logged. An `armada.broken` file makes every call fail, and an
 * `armada.break-after` file makes one appear after the next switch.
 */
export function fakeArmadaPower(profile = 'balanced') {
  const bin = mkdtempSync(join(tmpdir(), 'bundle-armada-'))
  writeFileSync(join(bin, 'profile'), `${profile}\n`)
  writeFileSync(
    join(bin, 'armada-power'),
    '#!/bin/sh\n' +
      'd=$(dirname "$0")\n' +
      'echo "$*" >>"$d/armada.log"\n' +
      '[ -e "$d/armada.broken" ] && exit 1\n' +
      'if [ "$*" = profile ]; then cat "$d/profile"\n' +
      'elif [ "$*" = status ]; then echo "profile=$(cat "$d/profile")"\n' +
      'elif [ "$1" = profile ] && [ $# = 2 ]; then echo "$2" >"$d/profile"\n' +
      '  if [ -e "$d/armada.break-after" ]; then : >"$d/armada.broken"; fi\n' +
      'else exit 2; fi\n'
  )
  chmodSync(join(bin, 'armada-power'), 0o755)
  return bin
}

/**
 * The pid launch.sh wrote to `file`, once it is there in full. `echo >`
 * creates the file before it writes the number, and an empty read would be
 * pid 0, which `process.kill` takes for the whole process group.
 */
export function writtenPid(file: string, timeoutMs = 10_000) {
  const by = Date.now() + timeoutMs
  for (;;) {
    const line = existsSync(file) ? readFileSync(file, 'utf8') : ''
    if (/^[1-9][0-9]*\n/.test(line)) return Number(line.split('\n')[0])
    assert.ok(Date.now() < by, `a pid in ${file}`)
    execFileSync('sleep', ['0.05'])
  }
}

/**
 * An app that asks the harness for each profile in turn, through its
 * request's handshake folder as the real one does (askForProfile), and
 * writes the answers to `seen`.
 */
export function profileAskingApp(seen: string, profiles: string[]) {
  return (
    '#!/bin/sh\n' +
    "exec python3 -I -c 'import json, os, sys, time\n" +
    'home = os.environ["GALLEON_HOME"]\n' +
    'hs = json.load(open(os.path.join(home, "self-test-request.json")))["handshakeDir"]\n' +
    'want, answer = os.path.join(hs, "want-profile"), os.path.join(hs, "profile-set")\n' +
    'said = []\n' +
    'for name in sys.argv[2:]:\n' +
    '    open(want + ".tmp", "w").write(name + "\\n")\n' +
    '    os.rename(want + ".tmp", want)\n' +
    '    got = "no-answer"\n' +
    '    for _ in range(300):\n' +
    '        if os.path.exists(answer):\n' +
    '            got = open(answer).read().strip()\n' +
    '            break\n' +
    '        time.sleep(0.05)\n' +
    '    os.remove(want)\n' +
    '    if os.path.exists(answer): os.remove(answer)\n' +
    '    said.append(got)\n' +
    'open(sys.argv[1], "w").write(" ".join(said))' +
    `' '${seen}' ${profiles.join(' ')}\n`
  )
}

/**
 * The stub app, refusing `--appimage-extract` unless it answers that itself:
 * the bundle asks for the fake RomM, and a stub run for extraction would
 * otherwise be a whole run of the app while run.sh waits to start the fake.
 */
function cannotExtract(script: string): string {
  if (script.includes('--appimage-extract')) return script
  const refuse = '[ "$1" = --appimage-extract ] && exit 1\n'
  if (!script.startsWith('#!')) return refuse + script
  const end = script.indexOf('\n') + 1
  return script.slice(0, end) + refuse + script.slice(end)
}

export function runHarness(
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
    writeFileSync(image, cannotExtract(appimage === true ? '' : appimage))
    chmodSync(image, 0o755)
  }
  const path = env.PATH ?? process.env.PATH
  const testRoot = env.GALLEON_TEST_ROOT ?? mkdtempSync(join(tmpdir(), 'bundle-testroot-'))
  const testDir = join(testRoot, sha)
  mkdirSync(testDir, { recursive: true })
  const home = env.HOME ?? mkdtempSync(join(tmpdir(), 'bundle-home-'))
  // Steam already lists the test shortcut unless the test says otherwise,
  // and its debugger shows the screen the fake client is on.
  if (!env.GALLEON_STEAM_CEF) withShortcut(home)
  const cef = env.GALLEON_STEAM_CEF ? undefined : steamScreen(session)
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
      GALLEON_POLL_SECONDS: '0.05',
      // The owner's home: the bridge's settings, the owner state and Steam's
      // shortcuts are read from it.
      ...(cef ? { GALLEON_STEAM_CEF: `http://127.0.0.1:${cef.port}` } : {}),
      ...env,
      HOME: home,
      PATH: `${session}:${path}`
    },
    encoding: 'utf8'
  })
  cef?.server.kill()
  return { run, results, testDir, testRoot, home }
}

/**
 * Steam's debugger, as far as its window list: the Game Mode window's address
 * carries the route the fake client in `session` last wrote.
 */
export function steamScreen(session: string) {
  return pythonServer(
    'import http.server, json, sys\n' +
      'class H(http.server.BaseHTTPRequestHandler):\n' +
      '    def do_GET(self):\n' +
      '        route = open(sys.argv[2]).read().strip()\n' +
      '        body = json.dumps([{"title": "Steam Big Picture Mode",\n' +
      '            "url": "https://steamloopback.host/routes" + route}]).encode()\n' +
      '        self.send_response(200); self.send_header("Content-Length", str(len(body)))\n' +
      '        self.end_headers(); self.wfile.write(body)\n' +
      '    def log_message(self, *args): pass\n' +
      's = http.server.HTTPServer(("127.0.0.1", 0), H)\n' +
      'open(sys.argv[1] + ".tmp", "w").write(str(s.server_address[1]))\n' +
      'import os; os.rename(sys.argv[1] + ".tmp", sys.argv[1])\n' +
      's.serve_forever()\n',
    join(session, 'route')
  )
}

/** A Python server on a loopback port it writes to a file, in a process of its own. */
export function pythonServer(script: string, ...args: string[]) {
  const portFile = join(mkdtempSync(join(tmpdir(), 'bundle-cef-')), 'port')
  const server = spawn('python3', ['-I', '-c', script, portFile, ...args], { stdio: 'ignore' })
  while (!existsSync(portFile)) execFileSync('sleep', ['0.05'])
  return { server, port: Number(readFileSync(portFile, 'utf8')) }
}

/**
 * A loopback server that answers its first request with a window list and
 * then none for a while, in a process of its own since the run blocks this one.
 */
export function answersOnceServer() {
  return pythonServer(
    'import os, socket, sys, time\n' +
      's = socket.socket(); s.bind(("127.0.0.1", 0)); s.listen(4)\n' +
      'open(sys.argv[1] + ".tmp", "w").write(str(s.getsockname()[1]))\n' +
      'os.rename(sys.argv[1] + ".tmp", sys.argv[1])\n' +
      'c, _ = s.accept(); c.recv(65536)\n' +
      'body = b\'[{"title": "Steam Big Picture Mode", "url": "https://steamloopback.host/routes/library/home"}]\'\n' +
      'c.sendall(b"HTTP/1.0 200 OK\\r\\nContent-Length: %d\\r\\n\\r\\n" % len(body) + body); c.close()\n' +
      'while True:\n' +
      '    c, _ = s.accept(); time.sleep(2); c.close()\n'
  )
}

/**
 * Whether a process still runs. A killed process stays in the table as a
 * zombie until its parent reaps it, which on a busy machine can be after
 * run.sh has returned, and `kill -0` cannot tell the two apart.
 */
export function running(pid: number): boolean {
  try {
    process.kill(pid, 0)
  } catch {
    return false
  }
  try {
    // The state is the field after the command, which is in parentheses.
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    return stat.slice(stat.lastIndexOf(')') + 2)[0] !== 'Z'
  } catch {
    return false
  }
}
