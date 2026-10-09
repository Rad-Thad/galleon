import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The environment an emulator is started with, rule by rule, and the process
 * it is started as.
 *
 * `GALLEON_HOME` and the debug level have to be set before `log.ts` is
 * imported, since it resolves both once, hence the dynamic import below.
 */

const root = mkdtempSync(join(tmpdir(), 'galleon-childenv-test-'))
after(() => rmSync(root, { recursive: true, force: true }))
process.env.GALLEON_HOME = root
process.env.ROMMIX_LOG = 'debug'

const { childEnvironment, environmentChanges, spawnEmulator, SYSTEM_PATH } =
  await import('./childenv.ts')

const APPDIR = '/tmp/.mount_GalleoXyZ123'

/** What Galleon's own environment looks like as an AppImage inside Steam's session. */
function steamAppImageEnv(): Record<string, string> {
  return {
    APPDIR,
    APPIMAGE: '/home/deck/Applications/Galleon.AppImage',
    ARGV0: 'Galleon.AppImage',
    OWD: '/home/deck',
    LD_LIBRARY_PATH: `${APPDIR}/usr/lib:/home/deck/.steam/lib`,
    LD_PRELOAD:
      '/home/deck/.local/share/Steam/ubuntu12_32/gameoverlayrenderer.so:/home/deck/.local/share/Steam/ubuntu12_64/gameoverlayrenderer.so',
    PATH: `${APPDIR}:${APPDIR}/usr/bin:/home/deck/.local/bin:/usr/bin:/usr/sbin`,
    DISPLAY: ':0',
    WAYLAND_DISPLAY: 'gamescope-0',
    XDG_RUNTIME_DIR: '/run/user/1000',
    SteamAppId: '0',
    SteamGameId: '1234567890',
    STEAM_COMPAT_CLIENT_INSTALL_PATH: '/home/deck/.local/share/Steam'
  }
}

test("the AppImage runtime's own variables are dropped", () => {
  const env = childEnvironment(steamAppImageEnv())
  for (const name of ['APPDIR', 'APPIMAGE', 'ARGV0', 'OWD']) {
    assert.equal(env[name], undefined, name)
  }
})

test('library path entries inside the image are dropped, and the session’s own kept', () => {
  assert.equal(childEnvironment(steamAppImageEnv()).LD_LIBRARY_PATH, '/home/deck/.steam/lib')
  const onlyImage = { ...steamAppImageEnv(), LD_LIBRARY_PATH: `${APPDIR}/usr/lib:${APPDIR}/lib` }
  assert.ok(
    !('LD_LIBRARY_PATH' in childEnvironment(onlyImage)),
    'a path left empty is unset, not set to ""'
  )
  // A sibling whose name starts like the mount point is not inside it.
  const sibling = { ...steamAppImageEnv(), LD_LIBRARY_PATH: `${APPDIR}-other/lib` }
  assert.equal(childEnvironment(sibling).LD_LIBRARY_PATH, `${APPDIR}-other/lib`)
})

test('outside an AppImage the library path is left alone', () => {
  const env = childEnvironment({ PATH: '/usr/bin', LD_LIBRARY_PATH: '/opt/lib:/usr/local/lib' })
  assert.equal(env.LD_LIBRARY_PATH, '/opt/lib:/usr/local/lib')
})

test("Steam's overlay preload is dropped, and any other preload kept", () => {
  assert.ok(!('LD_PRELOAD' in childEnvironment(steamAppImageEnv())))
  const mixed = {
    ...steamAppImageEnv(),
    LD_PRELOAD:
      '/usr/lib/libgamemodeauto.so.0 /home/deck/.local/share/Steam/ubuntu12_64/gameoverlayrenderer.so'
  }
  assert.equal(childEnvironment(mixed).LD_PRELOAD, '/usr/lib/libgamemodeauto.so.0')
  // Only the file of that name: a library that merely mentions it stays.
  const lookalike = { PATH: '/usr/bin', LD_PRELOAD: '/opt/notgameoverlayrenderer.so' }
  assert.equal(childEnvironment(lookalike).LD_PRELOAD, '/opt/notgameoverlayrenderer.so')
})

test('the system directories come first on PATH, the image’s go, and the rest keep their order', () => {
  assert.equal(
    childEnvironment(steamAppImageEnv()).PATH,
    '/usr/bin:/usr/local/bin:/bin:/home/deck/.local/bin:/usr/sbin'
  )
  assert.equal(
    childEnvironment({}).PATH,
    SYSTEM_PATH.join(':'),
    'a parent with no PATH still gets the system one'
  )
})

test('display, session and Steam variables are kept unchanged', () => {
  const parent = steamAppImageEnv()
  const env = childEnvironment(parent)
  for (const name of [
    'DISPLAY',
    'WAYLAND_DISPLAY',
    'XDG_RUNTIME_DIR',
    'SteamAppId',
    'SteamGameId',
    'STEAM_COMPAT_CLIENT_INSTALL_PATH'
  ]) {
    assert.equal(env[name], parent[name], name)
  }
})

test("the descriptor's variables apply last and can set what the rules dropped", () => {
  const env = childEnvironment(steamAppImageEnv(), {
    QT_QPA_PLATFORM: 'xcb',
    LD_LIBRARY_PATH: '/opt/emu/lib'
  })
  assert.equal(env.QT_QPA_PLATFORM, 'xcb')
  assert.equal(env.LD_LIBRARY_PATH, '/opt/emu/lib')
})

test('the parent environment is not modified', () => {
  const parent = steamAppImageEnv()
  const copy = { ...parent }
  childEnvironment(parent, { EXTRA: '1' })
  assert.deepEqual(parent, copy)
})

test('the differences name every variable dropped and every value set', () => {
  const parent = steamAppImageEnv()
  const changes = environmentChanges(parent, childEnvironment(parent, { QT_QPA_PLATFORM: 'xcb' }))
  assert.deepEqual(changes.removed, ['APPDIR', 'APPIMAGE', 'ARGV0', 'LD_PRELOAD', 'OWD'])
  assert.deepEqual(changes.set, {
    LD_LIBRARY_PATH: '/home/deck/.steam/lib',
    PATH: '/usr/bin:/usr/local/bin:/bin:/home/deck/.local/bin:/usr/sbin',
    QT_QPA_PLATFORM: 'xcb'
  })
})

/** The parent pid and session id of `pid`, from /proc. */
function processInfo(pid: number): { ppid: number; sid: number } {
  // The command name is in parentheses and may hold spaces; fields count from after it.
  const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
  const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
  return { ppid: Number(fields[1]), sid: Number(fields[3]) }
}

test('the emulator is a direct child of the launcher in a session of its own, and the differences are logged once', async () => {
  const child = spawnEmulator(['sleep', '30'], { GALLEON_TEST_MARK: '1' })
  const pid = child.pid
  assert.ok(pid, 'the process started')
  try {
    const info = processInfo(pid)
    assert.equal(info.ppid, process.pid, 'not double-forked or reparented to init')
    assert.equal(info.sid, pid, 'it leads its own session, so it can be asked to quit as a group')
    const environ = readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0')
    assert.ok(environ.includes('GALLEON_TEST_MARK=1'), 'it received the built environment')
    assert.ok(environ.includes(`PATH=${childEnvironment(process.env).PATH}`))
  } finally {
    // Only the pid recorded above is signalled.
    const exited = new Promise((resolve) => child.once('exit', resolve))
    process.kill(pid, 'SIGTERM')
    await exited
  }

  const lines = readFileSync(join(root, 'logs', 'app.log'), 'utf8')
    .split('\n')
    .filter((line) => line.includes('child environment'))
  assert.equal(lines.length, 1, 'one line per launch')
  assert.match(lines[0], / DEBUG /)
  assert.match(lines[0], /GALLEON_TEST_MARK/)
})
